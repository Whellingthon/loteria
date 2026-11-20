import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCiVQfU7l-42dWHqKfHoY6ydDV0EnnbCsM",
  authDomain: "myproject-5f316.firebaseapp.com",
  projectId: "myproject-5f316",
  storageBucket: "myproject-5f316.firebasestorage.app",
  messagingSenderId: "619121746350",
  appId: "1:619121746350:web:fef8bfa3a8948843ff683f",
  measurementId: "G-WMD9FCF56S"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Constantes da Lotofácil
const MOLDURA = new Set([1, 2, 3, 4, 5, 6, 10, 11, 15, 16, 20, 21, 22, 23, 24, 25]);
const PRIMOS = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23]);

let estado = {
  resumo: null,
  ultimosSorteios: [],
  ultimoSorteioSet: new Set(),
  estatisticas: []
};

const elStatus = document.getElementById("status-base");
const elBadge = document.getElementById("badge-ultimo");
const elUltimoSorteio = document.getElementById("ultimo-sorteio");
const elTabela = document.getElementById("tabela-estatisticas");
const elListaJogos = document.getElementById("lista-jogos");
const btnGerar = document.getElementById("btn-gerar");

async function carregarDados() {
  try {
    const [snapResumo, snapUltimos] = await Promise.all([
      getDoc(doc(db, "lotofacil", "resumo_geral")),
      getDoc(doc(db, "lotofacil", "ultimos_100"))
    ]);

    if (!snapResumo.exists() || !snapUltimos.exists()) {
      elStatus.textContent = "Base vazia. Rode o script atualizar_lotofacil.py primeiro.";
      elStatus.classList.add("status-erro");
      return;
    }

    const resumo = snapResumo.data();
    const sorteios = snapUltimos.data().sorteios || [];
    const ultimo = sorteios[sorteios.length - 1];

    estado.resumo = resumo;
    estado.ultimosSorteios = sorteios;
    estado.ultimoSorteioSet = new Set(ultimo ? ultimo.dezenas : []);

    const total = resumo.total_concursos;
    const ultimoNum = resumo.ultimo_concurso;

    estado.estatisticas = Object.entries(resumo.dezenas).map(([dez, info]) => {
      const numero = Number(dez);
      const prob = (info.aparicoes / total) * 100;
      const atraso = ultimoNum - info.ultimo_concurso;
      return { numero, aparicoes: info.aparicoes, prob, atraso };
    });

    elBadge.textContent = `Concurso #${ultimoNum}`;
    elStatus.textContent = `${total} concursos analisados • Atualizado em ${resumo.data_atualizacao}`;

    renderizarUltimoSorteio(ultimo ? ultimo.dezenas : []);
    renderizarTabela(estado.estatisticas);
    btnGerar.disabled = false;
  } catch (erro) {
    console.error(erro);
    elStatus.textContent = "Erro ao conectar ao Firestore. Verifique as regras de leitura.";
    elStatus.classList.add("status-erro");
  }
}

function renderizarUltimoSorteio(dezenas) {
  elUltimoSorteio.innerHTML = dezenas
    .map(d => `<div class="bolinha">${String(d).padStart(2, "0")}</div>`)
    .join("");
}

function renderizarTabela(lista) {
  const ordenada = [...lista].sort((a, b) => b.aparicoes - a.aparicoes || b.atraso - a.atraso);
  elTabela.innerHTML = ordenada
    .map(item => `
      <tr>
        <td>${String(item.numero).padStart(2, "0")}</td>
        <td>${item.aparicoes}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <span>${item.prob.toFixed(1)}%</span>
            <div class="barra"><div style="width:${Math.min(100, item.prob).toFixed(1)}%"></div></div>
          </div>
        </td>
        <td class="${item.atraso >= 3 ? "atraso-alta" : ""}">${item.atraso}</td>
      </tr>
    `)
    .join("");
}

function calcularJogoModaPosicional() {
  const escolhidas = new Set();
  const detalhesPosicoes = [];

  for (let pos = 0; pos < 15; pos++) {
    const contagem = {};
    for (const sorteio of estado.ultimosSorteios) {
      const lista = sorteio.ordem_sorteio || sorteio.dezenas;
      const num = lista[pos];
      contagem[num] = (contagem[num] || 0) + 1;
    }

    const ranking = Object.entries(contagem)
      .map(([num, freq]) => ({ num: Number(num), freq }))
      .sort((a, b) => b.freq - a.freq);

    const vencedor = ranking.find(item => !escolhidas.has(item.num));
    if (vencedor) {
      escolhidas.add(vencedor.num);
      detalhesPosicoes.push({ posicao: pos + 1, numero: vencedor.num, vezes: vencedor.freq });
    }
  }

  return {
    jogo: Array.from(escolhidas).sort((a, b) => a - b),
    detalhesPosicoes
  };
}

function sortearPonderado(estrategia) {
  const pool = estado.estatisticas.map(item => {
    let peso = 1;
    if (estrategia === "frequencia") peso = item.prob;
    else if (estrategia === "atraso") peso = 1 + item.atraso * 2;
    else peso = item.prob + item.atraso * 1.5;
    return { numero: item.numero, peso };
  });

  const escolhidas = [];
  for (let i = 0; i < 15; i++) {
    const somaPesos = pool.reduce((acc, p) => acc + p.peso, 0);
    let r = Math.random() * somaPesos;
    let idx = 0;

    for (let j = 0; j < pool.length; j++) {
      r -= pool[j].peso;
      if (r <= 0) {
        idx = j;
        break;
      }
    }
    escolhidas.push(pool[idx].numero);
    pool.splice(idx, 1);
  }
  return escolhidas.sort((a, b) => a - b);
}

function validarJogo(jogo) {
  const pares = jogo.filter(n => n % 2 === 0).length;
  if (pares < 7 || pares > 8) return false;

  const soma = jogo.reduce((acc, n) => acc + n, 0);
  if (soma < 180 || soma > 210) return false;

  const naMoldura = jogo.filter(n => MOLDURA.has(n)).length;
  if (naMoldura < 9 || naMoldura > 11) return false;

  const primos = jogo.filter(n => PRIMOS.has(n)).length;
  if (primos < 4 || primos > 6) return false;

  if (estado.ultimoSorteioSet.size === 15) {
    const repetidas = jogo.filter(n => estado.ultimoSorteioSet.has(n)).length;
    if (repetidas < 8 || repetidas > 10) return false;
  }

  return true;
}

function gerarJogos() {
  const estrategia = document.getElementById("estrategia").value;

  if (estrategia === "moda_posicional") {
    const { jogo, detalhesPosicoes } = calcularJogoModaPosicional();
    const soma = jogo.reduce((a, b) => a + b, 0);
    const pares = jogo.filter(n => n % 2 === 0).length;
    const reps = jogo.filter(n => estado.ultimoSorteioSet.has(n)).length;

    const resumoPosicoes = detalhesPosicoes
      .map(d => `${d.posicao}ª: <strong>${String(d.numero).padStart(2, "0")}</strong> (${d.vezes}x)`)
      .join(" • ");

    elListaJogos.innerHTML = `
      <div class="jogo" style="grid-column: 1 / -1;">
        <header>
          <span>Moda Posicional (últimos ${estado.ultimosSorteios.length} concursos)</span>
          <span class="meta">Soma ${soma} • ${pares}P/${15 - pares}Í • ${reps} repetidas</span>
        </header>
        <div class="dezenas">
          ${jogo.map(n => `<span class="${estado.ultimoSorteioSet.has(n) ? "rep" : ""}">${String(n).padStart(2, "0")}</span>`).join("")}
        </div>
        <p class="nota-filtros" style="margin: 12px 0 0 0;">${resumoPosicoes}</p>
      </div>
    `;
    return;
  }

  const qtd = Math.min(20, Math.max(1, Number(document.getElementById("qtd-jogos").value) || 5));
  const jogos = [];
  const assinaturas = new Set();

  let tentativas = 0;
  const maxTentativas = 30000;

  while (jogos.length < qtd && tentativas < maxTentativas) {
    tentativas++;
    const candidato = sortearPonderado(estrategia);
    const chave = candidato.join("-");
    if (!assinaturas.has(chave) && validarJogo(candidato)) {
      assinaturas.add(chave);
      jogos.push(candidato);
    }
  }

  if (jogos.length === 0) {
    elListaJogos.innerHTML = `<p class="nota-filtros">Nenhum jogo passou nos filtros após ${tentativas} tentativas. Tente outra estratégia.</p>`;
    return;
  }

  elListaJogos.innerHTML = jogos.map((jogo, i) => {
    const soma = jogo.reduce((a, b) => a + b, 0);
    const pares = jogo.filter(n => n % 2 === 0).length;
    const moldura = jogo.filter(n => MOLDURA.has(n)).length;
    const primos = jogo.filter(n => PRIMOS.has(n)).length;
    const reps = jogo.filter(n => estado.ultimoSorteioSet.has(n)).length;

    return `
      <div class="jogo">
        <header>
          <span>Jogo ${i + 1}</span>
          <span class="meta">Soma ${soma} • ${pares}P/${15 - pares}Í • ${moldura} moldura • ${primos} primos • ${reps} rep.</span>
        </header>
        <div class="dezenas">
          ${jogo.map(n => `<span class="${estado.ultimoSorteioSet.has(n) ? "rep" : ""}">${String(n).padStart(2, "0")}</span>`).join("")}
        </div>
      </div>
    `;
  }).join("");
}

btnGerar.addEventListener("click", gerarJogos);
carregarDados();