import sharp from 'sharp';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'selfies';

// Fotos de celular vem gravadas deitadas, com uma etiqueta EXIF dizendo o quanto
// girar. O navegador respeita a etiqueta e mostra em pe, mas o detector de rosto
// le os pixels crus: ve um rosto deitado, nao detecta nada e o face swap sai sem
// efeito. Era a causa das fotos voltarem com o rosto do modelo do template.
const LADO_MAXIMO = 1600;

function urlPublica(caminho) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${caminho}`;
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
 * Deixa a selfie em pe (aplicando a etiqueta EXIF) e num tamanho razoavel,
 * salva no Storage e devolve a URL publica que vai para o Replicate.
 * Idempotente: o caminho vem do id da selfie.
 * Se qualquer coisa falhar, devolve a URL original em vez de derrubar o fluxo.
 */
export async function normalizarSelfie(selfieId, selfieUrl) {
  if (!selfieId || !selfieUrl) return selfieUrl;

  const caminho = `normalizadas/${selfieId}.jpg`;

  try {
    if (await jaExiste(caminho)) return urlPublica(caminho);

    const r = await fetch(selfieUrl);
    if (!r.ok) throw new Error(`download da selfie falhou (${r.status})`);
    const original = Buffer.from(await r.arrayBuffer());

    const antes = await sharp(original).metadata();

    // .rotate() sem argumento aplica a orientacao gravada no EXIF
    const corrigida = await sharp(original)
      .rotate()
      .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();

    const depois = await sharp(corrigida).metadata();
    console.log(
      `[Selfie] ${selfieId}: EXIF ${antes.orientation ?? 'nenhum'}, ` +
      `${antes.width}x${antes.height} -> ${depois.width}x${depois.height}`
    );

    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${caminho}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true'
      },
      body: corrigida
    });

    if (!up.ok) throw new Error(`upload falhou (${up.status})`);

    return urlPublica(caminho);
  } catch (e) {
    console.error(`[Selfie] nao consegui normalizar ${selfieId}, usando a original:`, e.message);
    return selfieUrl;
  }
}
