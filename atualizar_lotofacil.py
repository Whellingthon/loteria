import time
import requests
import urllib3
import firebase_admin
from firebase_admin import credentials, firestore

# Silencia o aviso de SSL (a API da Caixa costuma ter cadeia de certificado antiga)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

API_URL = "https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil"
COLECAO = "lotofacil"
CARGA_INICIAL_QTD = 100  # Quantos concursos puxar se o banco estiver vazio

def inicializar_firebase():
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    return firestore.client()

def buscar_concurso_caixa(numero=None):
    url = f"{API_URL}/{numero}" if numero else API_URL
    headers = {"User-Agent": "Mozilla/5.0"}
    resp = requests.get(url, headers=headers, verify=False, timeout=15)
    resp.raise_for_status()
    return resp.json()

def criar_resumo_vazio():
    return {
        "ultimo_concurso": 0,
        "data_atualizacao": "",
        "total_concursos": 0,
        "dezenas": {
            str(i): {"aparicoes": 0, "ultimo_concurso": 0}
            for i in range(1, 26)
        }
    }

def sincronizar():
    db = inicializar_firebase()
    
    ref_resumo = db.collection(COLECAO).document("resumo_geral")
    ref_ultimos = db.collection(COLECAO).document("ultimos_100")

    # 1. Lê o estado atual no Firestore (apenas 2 leituras)
    doc_resumo = ref_resumo.get()
    doc_ultimos = ref_ultimos.get()

    resumo = doc_resumo.to_dict() if doc_resumo.exists else criar_resumo_vazio()
    lista_ultimos = doc_ultimos.to_dict().get("sorteios", []) if doc_ultimos.exists else []

    ultimo_salvo = resumo["ultimo_concurso"]

    # 2. Descobre qual é o último concurso oficial na Caixa
    print("Consultando último concurso na Caixa...")
    dados_recente = buscar_concurso_caixa()
    ultimo_caixa = int(dados_recente["numero"])

    if ultimo_salvo >= ultimo_caixa:
        print(f"Tudo atualizado! Último concurso no banco já é o #{ultimo_salvo}.")
        return

    # Define o intervalo a buscar
    if ultimo_salvo == 0:
        inicio = max(1, ultimo_caixa - CARGA_INICIAL_QTD + 1)
        print(f"Banco vazio. Iniciando carga dos últimos {CARGA_INICIAL_QTD} concursos (#{inicio} até #{ultimo_caixa})...")
    else:
        inicio = ultimo_salvo + 1
        print(f"Buscando novos concursos do #{inicio} até #{ultimo_caixa}...")

    # 3. Processa os concursos em ordem crescente
    novos_processados = 0
    for num in range(inicio, ultimo_caixa + 1):
        try:
            # Reaproveita o JSON que já baixamos se for o último
            dados = dados_recente if num == ultimo_caixa else buscar_concurso_caixa(num)
            
            dezenas = [int(d) for d in dados["listaDezenas"]]
            # Pega a ordem exata do globo (se não existir, usa a lista padrão)
            ordem_sorteio = [int(d) for d in dados.get("dezenasSorteadasOrdemSorteio", dados["listaDezenas"])]
            data_apuracao = dados["dataApuracao"]
            soma = sum(dezenas)
            pares = sum(1 for d in dezenas if d % 2 == 0)

            # Atualiza o resumo_geral em memória
            resumo["ultimo_concurso"] = num
            resumo["data_atualizacao"] = data_apuracao
            resumo["total_concursos"] += 1

            for d in dezenas:
                chave = str(d)
                resumo["dezenas"][chave]["aparicoes"] += 1
                resumo["dezenas"][chave]["ultimo_concurso"] = num

            # Adiciona na fila dos últimos 100 com a ordem exata do globo
            lista_ultimos.append({
                "numero": num,
                "data": data_apuracao,
                "dezenas": dezenas,
                "ordem_sorteio": ordem_sorteio,
                "soma": soma,
                "pares": pares
            })

            novos_processados += 1
            print(f"[OK] Concurso #{num} ({data_apuracao}) processado.")
            
            # Pausa leve para não tomar bloqueio da API da Caixa
            if num < ultimo_caixa:
                time.sleep(0.3)

        except Exception as e:
            print(f"[ERRO] Falha ao buscar concurso #{num}: {e}")
            break  # Para a sequência para não deixar buraco na contagem

    if novos_processados == 0:
        print("Nenhum concurso novo foi salvo.")
        return

    # Mantém rigorosamente apenas os 100 mais recentes
    lista_ultimos = lista_ultimos[-100:]

    # 4. Grava os dois documentos de forma atômica (apenas 2 escritas no Firestore)
    batch = db.batch()
    batch.set(ref_resumo, resumo)
    batch.set(ref_ultimos, {"sorteios": lista_ultimos})
    batch.commit()

    print(f"\nSucesso! {novos_processados} concurso(s) gravados no Firestore.")

if __name__ == "__main__":
    sincronizar()