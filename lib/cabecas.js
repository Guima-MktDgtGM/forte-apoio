// Gerado automaticamente. Para cada template, a caixa da CABECA do apoiador
// (a area que os arquivos sem-cabeca-*.jpg tem preenchida de cinza).
// Junto com lib/caixas.js (rosto do politico), define de que lado esta cada um -
// e isso permite recortar so o lado do apoiador antes da passada final de face
// swap, sem risco de o swap pegar o rosto do candidato.

export const CABECAS = {
  bolsonaro_f_1: { caixa: { left: 480, top: 386, width: 192, height: 233 }, dimensoes: '832x1253' },
  bolsonaro_f_2: { caixa: { left: 248, top: 225, width: 160, height: 505 }, dimensoes: '832x1253' },
  bolsonaro_f_3: { caixa: { left: 520, top: 351, width: 160, height: 272 }, dimensoes: '832x1253' },
  bolsonaro_f_4: { caixa: { left: 472, top: 186, width: 288, height: 350 }, dimensoes: '1024x1024' },
  bolsonaro_f_5: { caixa: { left: 250, top: 503, width: 108, height: 188 }, dimensoes: '832x1253' },
  bolsonaro_m_1: { caixa: { left: 496, top: 15, width: 192, height: 272 }, dimensoes: '1376x768' },
  bolsonaro_m_2: { caixa: { left: 0, top: 50, width: 512, height: 739 }, dimensoes: '832x1253' },
  bolsonaro_m_3: { caixa: { left: 368, top: 172, width: 384, height: 583 }, dimensoes: '832x1253' },
  bolsonaro_m_4: { caixa: { left: 360, top: 138, width: 416, height: 622 }, dimensoes: '832x1253' },
  bolsonaro_m_5: { caixa: { left: 448, top: 81, width: 320, height: 505 }, dimensoes: '1024x1024' },
  lula_f_1: { caixa: { left: 253, top: 290, width: 133, height: 233 }, dimensoes: '1024x1024' },
  lula_f_2: { caixa: { left: 280, top: 402, width: 288, height: 233 }, dimensoes: '1024x1024' },
  lula_f_3: { caixa: { left: 309, top: 382, width: 133, height: 154 }, dimensoes: '1024x1024' },
  lula_f_4: { caixa: { left: 342, top: 66, width: 179, height: 233 }, dimensoes: '1376x768' },
  lula_f_5: { caixa: { left: 0, top: 346, width: 432, height: 350 }, dimensoes: '768x1365' },
  lula_m_1: { caixa: { left: 200, top: 74, width: 416, height: 622 }, dimensoes: '1024x1024' },
  lula_m_2: { caixa: { left: 349, top: 255, width: 133, height: 272 }, dimensoes: '1024x1024' },
  lula_m_3: { caixa: { left: 296, top: 0, width: 352, height: 467 }, dimensoes: '1024x1024' },
  lula_m_4: { caixa: { left: 334, top: 47, width: 179, height: 272 }, dimensoes: '1376x768' },
  lula_m_5: { caixa: { left: 365, top: 590, width: 133, height: 154 }, dimensoes: '1024x1024' }
};

// sem-cabeca-bolsonaro-2-m.jpg -> bolsonaro_m_2
export function chaveSemCabeca(url) {
  const m = String(url || '').match(/sem-cabeca-(lula|bolsonaro)-(\d+)-(m|f)\.jpg/);
  return m ? `${m[1]}_${m[3]}_${m[2]}` : null;
}
