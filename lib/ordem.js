// Ordem dos templates por tamanho da cabeca do apoiador, do maior para o menor.
// A previa gera UMA foto so, entao ela tem que cair no template de cabeca maior:
// quanto maior a cabeca, mais o cliente se reconhece. Os menores ficam para as
// fotos que ele recebe depois de pagar.

export const ORDEM = {
  bolsonaro_f: [4, 2, 1, 3, 5],
  bolsonaro_m: [2, 4, 3, 5, 1],
  lula_f: [5, 2, 4, 1, 3],
  lula_m: [1, 3, 4, 2, 5]
};

export function indiceDoTemplate(candidato, genero, posicao) {
  const lista = ORDEM[`${candidato}_${genero}`];
  if (!lista || !lista[posicao - 1]) return posicao;
  return lista[posicao - 1];
}
