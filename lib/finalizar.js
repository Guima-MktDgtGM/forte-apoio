import sharp from 'sharp';
import { CAIXAS, chaveDoTapado } from './caixas.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://forte-apoio.vercel.app';
const BUCKET = 'selfies';

// Quanto a area restaurada extrapola a caixa cinza, para o degrade das bordas
// cair sobre pixels originais e nao sobre o cinza. Fracao do lado da caixa.
const FOLGA = 0.14;

function urlPublica(caminho) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${caminho}`;
}

async function baixar(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download falhou (${r.status}) em ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// Cola o rosto do politico (vindo do template original) de volta na foto trocada.
// A mascara tem as bordas borradas para nao aparecer o retangulo da emenda.
export async function devolverRostoDoPolitico(fotoTrocada, templateOriginal, caixa) {
  const meta = await sharp(templateOriginal).metadata();
  const largura = meta.width;
  const altura = meta.height;

  // o modelo pode devolver a imagem em outro tamanho: normaliza pelo template
  const base = await sharp(fotoTrocada).resize(largura, altura, { fit: 'fill' }).toBuffer();

  const folga = Math.round(Math.min(caixa.width, caixa.height) * FOLGA);
  const area = {
    left: Math.max(0, caixa.left - folga),
    top: Math.max(0, caixa.top - folga)
  };
  area.width = Math.min(largura - area.left, caixa.left + caixa.width + folga - area.left);
  area.height = Math.min(altura - area.top, caixa.top + caixa.height + folga - area.top);

  // nucleo 100% opaco cobrindo toda a area cinza, com degrade para fora
  const nucleo = {
    left: caixa.left - area.left,
    top: caixa.top - area.top,
    width: caixa.width,
    height: caixa.height
  };

  // Mascara com alpha: transparente na borda, opaca sobre toda a area cinza.
  // O blur no alpha e o que faz a emenda desaparecer.
  const mascara = await sharp({
    create: {
      width: area.width,
      height: area.height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    }
  })
    .composite([{
      input: await sharp({
        create: {
          width: nucleo.width,
          height: nucleo.height,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      }).png().toBuffer(),
      left: nucleo.left,
      top: nucleo.top
    }])
    .blur(Math.max(1, folga / 2))
    .png()
    .toBuffer();

  const remendo = await sharp(templateOriginal)
    .extract(area)
    .ensureAlpha()
    .composite([{ input: mascara, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return sharp(base)
    .composite([{ input: remendo, left: area.left, top: area.top }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function jaExiste(caminho) {
  try {
    const r = await fetch(urlPublica(caminho), { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Recebe uma prediction concluida do Replicate, devolve o rosto do politico,
 * salva a foto definitiva no Supabase Storage e retorna a URL publica.
 * E idempotente: o caminho e derivado do id da prediction, entao rodar duas
 * vezes (webhook + polling) nao duplica nada.
 */
export async function finalizarFoto({ selfieId, predictionId, outputUrl, inputImageUrl }) {
  if (!selfieId || !predictionId || !outputUrl) {
    throw new Error('finalizarFoto: faltam selfieId, predictionId ou outputUrl');
  }

  const caminho = `resultados/${selfieId}/${predictionId}.jpg`;

  if (await jaExiste(caminho)) {
    console.log(`[Finalizar] ${predictionId} ja estava salvo`);
    return urlPublica(caminho);
  }

  const chave = chaveDoTapado(inputImageUrl);
  const config = chave ? CAIXAS[chave] : null;

  let foto = await baixar(outputUrl);

  if (config) {
    const original = await baixar(`${SITE_URL}/imagens/${encodeURIComponent(config.arquivo)}`);
    foto = await devolverRostoDoPolitico(foto, original, config.caixa);
    console.log(`[Finalizar] rosto do politico devolvido (${chave})`);
  } else {
    console.warn(`[Finalizar] template nao reconhecido em ${inputImageUrl} - salvando sem restaurar`);
  }

  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${caminho}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true'
    },
    body: foto
  });

  if (!up.ok) {
    throw new Error(`upload falhou (${up.status}): ${(await up.text()).slice(0, 200)}`);
  }

  console.log(`[Finalizar] foto salva em ${caminho}`);
  return urlPublica(caminho);
}
