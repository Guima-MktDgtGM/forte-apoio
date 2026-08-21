import sharp from 'sharp';
import { CABECAS } from './cabecas.js';
import { CAIXAS } from './caixas.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'selfies';
const replicateToken = process.env.REPLICATE_API_TOKEN;

const SWAP_VERSION = process.env.REPLICATE_SWAP_VERSION || 'd1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111';

// margem para o degrade da colagem, em fracao do lado do recorte
const FEATHER = 0.06;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Calcula, em FRACOES da imagem, o pedaco que contem so o apoiador.
 * O limite lateral e o meio do vao entre a cabeca dele e o rosto do politico,
 * garantindo que o candidato nunca entre no recorte que vai para o face swap.
 */
function recorteDoApoiador(chave) {
  const cabeca = CABECAS[chave];
  const politico = CAIXAS[chave];
  if (!cabeca || !politico) return null;

  const [W, H] = cabeca.dimensoes.split('x').map(Number);
  const c = cabeca.caixa;
  const p = politico.caixa;

  const centroApoiador = c.left + c.width / 2;
  const centroPolitico = p.left + p.width / 2;
  const apoiadorAEsquerda = centroApoiador < centroPolitico;

  // limite = meio do vao entre as duas caixas
  const limite = apoiadorAEsquerda
    ? (c.left + c.width + p.left) / 2
    : (p.left + p.width + c.left) / 2;

  const x0 = apoiadorAEsquerda ? 0 : Math.max(0, limite);
  const x1 = apoiadorAEsquerda ? Math.min(W, limite) : W;

  // vertical: a cabeca com folga para pegar ombro, sem varrer a imagem toda
  const y0 = Math.max(0, c.top - c.height * 0.15);
  const y1 = Math.min(H, c.top + c.height * 1.35);

  return { x0: x0 / W, x1: x1 / W, y0: y0 / H, y1: y1 / H };
}

async function subir(caminho, buffer, tipo = 'image/jpeg') {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${caminho}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': tipo,
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!r.ok) throw new Error(`upload falhou (${r.status})`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${caminho}`;
}

// Face swap sincrono (Prefer: wait). Repete uma vez se tomar o throttle 429.
async function trocarRosto(alvoUrl, selfieUrl) {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const r = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${replicateToken}`,
        'Content-Type': 'application/json',
        Prefer: 'wait'
      },
      body: JSON.stringify({
        version: SWAP_VERSION,
        input: { input_image: alvoUrl, swap_image: selfieUrl }
      })
    });

    const p = await r.json().catch(() => ({}));

    if (r.ok && p.status === 'succeeded' && p.output) {
      return Array.isArray(p.output) ? p.output[0] : p.output;
    }

    if (r.status === 429 && tentativa === 1) {
      const espera = p.retry_after ? (p.retry_after + 1) * 1000 : 12000;
      console.log(`[RostoReal] throttle, esperando ${espera}ms`);
      await sleep(espera);
      continue;
    }

    throw new Error(p.detail || p.error || `face swap falhou (${r.status}/${p.status})`);
  }
  throw new Error('face swap falhou apos retry');
}

/**
 * Passada final: o Gemini pintou a cabeca com o cabelo certo, mas o rosto e uma
 * recriacao. Aqui recortamos so o lado do apoiador, rodamos o face swap nesse
 * pedaco (um rosto so, o politico ficou fora) e colamos de volta - o rosto passa
 * a ser os pixels REAIS da selfie, dentro do cabelo que o Gemini desenhou.
 * Se qualquer etapa falhar, devolve a imagem do Gemini sem quebrar o fluxo.
 */
export async function aplicarRostoReal({ imagem, chave, selfieUrl, selfieId, predictionId }) {
  try {
    const frac = recorteDoApoiador(chave);
    if (!frac) {
      console.warn(`[RostoReal] sem coordenadas para ${chave}, pulando`);
      return imagem;
    }

    const meta = await sharp(imagem).metadata();
    const W = meta.width, H = meta.height;

    const area = {
      left: Math.max(0, Math.round(frac.x0 * W)),
      top: Math.max(0, Math.round(frac.y0 * H))
    };
    area.width = Math.min(W - area.left, Math.round(frac.x1 * W) - area.left);
    area.height = Math.min(H - area.top, Math.round(frac.y1 * H) - area.top);

    if (area.width < 80 || area.height < 80) {
      console.warn(`[RostoReal] recorte pequeno demais em ${chave}`, area);
      return imagem;
    }

    const recorte = await sharp(imagem).extract(area).jpeg({ quality: 95 }).toBuffer();
    const recorteUrl = await subir(`temp/${selfieId}-${predictionId}-recorte.jpg`, recorte);

    const saidaUrl = await trocarRosto(recorteUrl, selfieUrl);
    const trocado = Buffer.from(await (await fetch(saidaUrl)).arrayBuffer());

    // volta ao tamanho exato do recorte e cola com as bordas suavizadas
    const ajustado = await sharp(trocado).resize(area.width, area.height, { fit: 'fill' }).toBuffer();

    const folga = Math.round(Math.min(area.width, area.height) * FEATHER);
    const mascara = await sharp({
      create: { width: area.width, height: area.height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } }
    })
      .composite([{
        input: await sharp({
          create: {
            width: area.width - folga * 2,
            height: area.height - folga * 2,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          }
        }).png().toBuffer(),
        left: folga,
        top: folga
      }])
      .blur(Math.max(1, folga / 2))
      .png()
      .toBuffer();

    const remendo = await sharp(ajustado)
      .ensureAlpha()
      .composite([{ input: mascara, blend: 'dest-in' }])
      .png()
      .toBuffer();

    const final = await sharp(imagem)
      .composite([{ input: remendo, left: area.left, top: area.top }])
      .jpeg({ quality: 92 })
      .toBuffer();

    console.log(`[RostoReal] rosto real aplicado em ${chave}`);
    return final;

  } catch (e) {
    console.error('[RostoReal] falhou, devolvendo a imagem do Gemini:', e.message);
    return imagem;
  }
}
