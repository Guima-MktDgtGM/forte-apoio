// Gerado automaticamente. Para cada template, a caixa onde fica o ROSTO DO POLITICO.
// Os arquivos tapado-*.jpg tem essa area preenchida de cinza, para que o modelo de
// face swap so encontre o rosto do apoiador e nao troque o do candidato.
// Depois do swap, o rosto original do politico e colado de volta nessa mesma caixa.

export const CAIXAS = {
  bolsonaro_f_1: { arquivo: "exemplo-bolsonaro-1-f.png.jpeg", caixa: { left: 199, top: 391, width: 290, height: 290 } },
  bolsonaro_f_2: { arquivo: "exemplo-bolsonaro-2-f.png.jpeg", caixa: { left: 551, top: 359, width: 210, height: 306 } },
  bolsonaro_f_3: { arquivo: "exemplo-bolsonaro-3-f.png.jpeg", caixa: { left: 199, top: 407, width: 290, height: 290 } },
  bolsonaro_f_4: { arquivo: "exemplo-bolsonaro-4-f.png.jpeg", caixa: { left: 300, top: 284, width: 248, height: 248 } },
  bolsonaro_f_5: { arquivo: "exemplo-bolsonaro-5-f.png.jpeg", caixa: { left: 407, top: 519, width: 194, height: 194 } },
  bolsonaro_m_1: { arquivo: "exemplo-bolsonaro-1-m.png.jpeg", caixa: { left: 735, top: 80, width: 200, height: 250 } },
  bolsonaro_m_2: { arquivo: "exemplo-bolsonaro-2-m.png.jpeg", caixa: { left: 519, top: 359, width: 226, height: 306 } },
  bolsonaro_m_3: { arquivo: "exemplo-bolsonaro-3-m.png.jpeg", caixa: { left: 199, top: 407, width: 274, height: 274 } },
  bolsonaro_m_5: { arquivo: "exemplo-bolsonaro-5-m.png.jpeg", caixa: { left: 300, top: 284, width: 232, height: 248 } },
  bolsonaro_m_4: { arquivo: "exemplo-bolsonaro-4-m.png.jpeg", caixa: { left: 199, top: 391, width: 274, height: 306 } },
  lula_f_1: { arquivo: "exemplo-lula-1-f.jpg.jpeg", caixa: { left: 540, top: 316, width: 264, height: 312 } },
  lula_f_2: { arquivo: "exemplo-lula-2-f.jpg.jpeg", caixa: { left: 492, top: 300, width: 280, height: 344 } },
  lula_f_3: { arquivo: "exemplo-lula-3-f.jpg.jpeg", caixa: { left: 556, top: 364, width: 216, height: 264 } },
  lula_f_4: { arquivo: "exemplo-lula-4-f.jpg.jpeg", caixa: { left: 916, top: 100, width: 168, height: 216 } },
  lula_f_5: { arquivo: "exemplo-lula-5-f.jpg.jpeg", caixa: { left: 380, top: 240, width: 340, height: 440 } },
  lula_m_2: { arquivo: "exemplo-lula-2-m.jpg.jpeg", caixa: { left: 540, top: 316, width: 264, height: 312 } },
  lula_m_1: { arquivo: "exemplo-lula-1-m.jpg.jpeg", caixa: { left: 508, top: 300, width: 264, height: 344 } },
  lula_m_3: { arquivo: "exemplo-lula-3-m.jpg.jpeg", caixa: { left: 620, top: 204, width: 328, height: 440 } },
  lula_m_4: { arquivo: "exemplo-lula-4-m.jpg.jpeg", caixa: { left: 916, top: 100, width: 168, height: 216 } },
  lula_m_5: { arquivo: "exemplo-lula-5-m.jpg.jpeg", caixa: { left: 508, top: 700, width: 136, height: 152 } }
};

// tapado-bolsonaro-2-m.jpg -> bolsonaro_m_2
export function chaveDoTapado(url) {
  const m = String(url || '').match(/tapado-(lula|bolsonaro)-(\d+)-(m|f)\.jpg/);
  return m ? `${m[1]}_${m[3]}_${m[2]}` : null;
}
