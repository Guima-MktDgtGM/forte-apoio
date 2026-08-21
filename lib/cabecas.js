// Gerado automaticamente. Para cada template, a caixa da CABECA do apoiador
// (a area que os arquivos sem-cabeca-*.jpg tem preenchida de cinza).
// Junto com lib/caixas.js (rosto do politico), define de que lado esta cada um -
// e isso permite recortar so o lado do apoiador antes da passada final de face
// swap, sem risco de o swap pegar o rosto do candidato.

export const CABECAS = {
  bolsonaro_f_1: { caixa: { left: 499, top: 429, width: 154, height: 177 }, dimensoes: '832x1253' },
  bolsonaro_f_2: { caixa: { left: 264, top: 318, width: 128, height: 385 }, dimensoes: '832x1253' },
  bolsonaro_f_3: { caixa: { left: 536, top: 402, width: 128, height: 207 }, dimensoes: '832x1253' },
  bolsonaro_f_4: { caixa: { left: 501, top: 251, width: 230, height: 267 }, dimensoes: '1024x1024' },
  bolsonaro_f_5: { caixa: { left: 278, top: 574, width: 52, height: 89 }, dimensoes: '832x1253' },
  bolsonaro_m_1: { caixa: { left: 515, top: 66, width: 154, height: 207 }, dimensoes: '1376x768' },
  bolsonaro_m_2: { caixa: { left: 51, top: 187, width: 410, height: 563 }, dimensoes: '832x1253' },
  bolsonaro_m_3: { caixa: { left: 406, top: 280, width: 308, height: 444 }, dimensoes: '832x1253' },
  bolsonaro_m_4: { caixa: { left: 402, top: 253, width: 332, height: 473 }, dimensoes: '832x1253' },
  bolsonaro_m_5: { caixa: { left: 480, top: 174, width: 256, height: 385 }, dimensoes: '1024x1024' },
  lula_f_1: { caixa: { left: 269, top: 333, width: 102, height: 177 }, dimensoes: '1024x1024' },
  lula_f_2: { caixa: { left: 309, top: 445, width: 230, height: 177 }, dimensoes: '1024x1024' },
  lula_f_3: { caixa: { left: 338, top: 430, width: 76, height: 89 }, dimensoes: '1024x1024' },
  lula_f_4: { caixa: { left: 381, top: 109, width: 102, height: 177 }, dimensoes: '1376x768' },
  lula_f_5: { caixa: { left: 29, top: 411, width: 358, height: 267 }, dimensoes: '768x1365' },
  lula_m_1: { caixa: { left: 242, top: 189, width: 332, height: 473 }, dimensoes: '1024x1024' },
  lula_m_2: { caixa: { left: 365, top: 306, width: 102, height: 207 }, dimensoes: '1024x1024' },
  lula_m_3: { caixa: { left: 331, top: 0, width: 282, height: 436 }, dimensoes: '1024x1024' },
  lula_m_4: { caixa: { left: 360, top: 98, width: 128, height: 207 }, dimensoes: '1376x768' },
  lula_m_5: { caixa: { left: 406, top: 638, width: 52, height: 89 }, dimensoes: '1024x1024' }
};

// sem-cabeca-bolsonaro-2-m.jpg -> bolsonaro_m_2
export function chaveSemCabeca(url) {
  const m = String(url || '').match(/sem-cabeca-(lula|bolsonaro)-(\d+)-(m|f)\.jpg/);
  return m ? `${m[1]}_${m[3]}_${m[2]}` : null;
}
