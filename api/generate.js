import { createClient } from '@supabase/supabase-js';
import { normalizarSelfie } from '../lib/selfie.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const replicateToken = process.env.REPLICATE_API_TOKEN;

// Public site URL: Replicate downloads the template images from here
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://forte-apoio.vercel.app';

// Free preview: only the 3 photos shown on the result screen are generated
// before payment. Photos 4 and 5 come after the 5 photo package is bought.
const PREVIEW_PHOTO_COUNT = 3;
const FULL_PHOTO_COUNT = 5;

// Face swap. The templates sent here are the "tapado-*" ones, which have the
// politician's face covered by a grey rectangle: with only the supporter's face
// left to detect, the model cannot put the customer's face on Lula/Bolsonaro.
// /api/replicate-hook pastes the politician's real face back afterwards.
const MODEL_VERSION = process.env.REPLICATE_MODEL_VERSION || 'd1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111';

// Replicate throttles prediction creation to a burst of 1 while the account has
// less than $5 of credit, so predictions are created one at a time with retries.
const CREATE_BUDGET_MS = 45000;
const DEFAULT_RETRY_AFTER_MS = 11000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Templates with the politician's face covered (see lib/caixas.js)
function buildTemplateUrls(dbCandidate, fromIndex, toIndex) {
  const raw = dbCandidate || 'lula';
  const [cand, gender] = raw.includes('_') ? raw.split('_') : [raw, 'm'];
  const candidato = cand === 'lula' ? 'lula' : 'bolsonaro';
  const list = [];

  for (let i = fromIndex; i <= toIndex; i++) {
    const custom = process.env[`TEMPLATE_${candidato.toUpperCase()}_${gender.toUpperCase()}_${i}`];
    list.push(custom || `${SITE_URL}/imagens/tapado-${candidato}-${i}-${gender}.jpg`);
  }

  return list;
}

async function createPrediction(templateUrl, sourceImageUrl, hookUrl) {
  const r = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${replicateToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      version: MODEL_VERSION,
      input: {
        input_image: templateUrl,  // template with the politician's face covered
        swap_image: sourceImageUrl // the customer's selfie
      },
      webhook: hookUrl,
      webhook_events_filter: ['completed']
    })
  });

  const payload = await r.json().catch(() => ({}));

  if (!r.ok) {
    const err = new Error(payload.detail || payload.title || `Replicate HTTP ${r.status}`);
    err.status = r.status;
    err.retryAfterMs = payload.retry_after ? (payload.retry_after + 1) * 1000 : DEFAULT_RETRY_AFTER_MS;
    throw err;
  }

  return payload.id;
}

// Creates the predictions ONE AT A TIME, waiting out any 429 throttle.
async function createPredictionsSequentially(templates, sourceImageUrl, hookUrl) {
  const deadline = Date.now() + CREATE_BUDGET_MS;
  const created = [];
  let lastError = null;

  for (const templateUrl of templates) {
    let placed = false;

    while (!placed && Date.now() < deadline) {
      try {
        created.push(await createPrediction(templateUrl, sourceImageUrl, hookUrl));
        placed = true;
      } catch (e) {
        lastError = e;

        if (e.status !== 429) {
          console.error('[API Generate] Non-throttle error creating prediction:', e.message);
          return { created, error: e };
        }

        const waitMs = e.retryAfterMs || DEFAULT_RETRY_AFTER_MS;
        if (Date.now() + waitMs >= deadline) {
          console.warn('[API Generate] Throttled and out of time budget. Returning partial batch.');
          return { created, error: null };
        }

        console.log(`[API Generate] Throttled by Replicate (low credit). Waiting ${waitMs}ms.`);
        await sleep(waitMs);
      }
    }

    if (!placed) break;
  }

  return { created, error: created.length === 0 ? lastError : null };
}

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { selfieId, extra, target } = req.body || {};
    if (!selfieId) return res.status(400).json({ error: 'Missing selfieId' });

    if (!replicateToken) {
      console.error('[API Generate] REPLICATE_API_TOKEN is not set.');
      return res.status(500).json({ error: 'Replicate token not set' });
    }

    const { data: selfieRecord, error: fetchError } = await supabase
      .from('selfies')
      .select('*')
      .eq('id', selfieId)
      .single();

    if (fetchError || !selfieRecord) {
      console.error(`[API Generate] Selfie record not found for ID: ${selfieId}`, fetchError);
      return res.status(404).json({ error: 'Selfie record not found' });
    }

    const sourceImageUrl = selfieRecord.selfie_url;
    if (!sourceImageUrl) {
      return res.status(400).json({ error: 'DB record is missing selfie_url' });
    }

    const existingUrls = selfieRecord.result_url ? selfieRecord.result_url.split(',').filter(Boolean) : [];

    const wanted = extra
      ? Math.min(Number(target) || FULL_PHOTO_COUNT, FULL_PHOTO_COUNT)
      : PREVIEW_PHOTO_COUNT;

    console.log(`[API Generate] ${extra ? 'EXTRA' : 'PREVIEW'} for ${selfieId}: ${existingUrls.length}/${wanted} done`);

    if (existingUrls.length >= wanted) {
      return res.status(200).json({ status: 'success', results: existingUrls });
    }

    // Deixa a selfie em pe antes de mandar pro Replicate: foto de celular vem
    // deitada com etiqueta EXIF, e o detector de rosto le os pixels crus.
    const selfieNormalizada = await normalizarSelfie(selfieId, sourceImageUrl);

    const templates = buildTemplateUrls(selfieRecord.candidate, existingUrls.length + 1, wanted);
    const hookUrl = `${SITE_URL}/api/replicate-hook?selfieId=${encodeURIComponent(selfieId)}`;

    console.log(`[API Generate] Queueing ${templates.length} face swaps for ${selfieId}:`, templates);

    const { created, error } = await createPredictionsSequentially(templates, selfieNormalizada, hookUrl);

    if (error && created.length === 0) {
      console.error('[API Generate] Failed to queue any prediction:', error.message);
      await supabase
        .from('selfies')
        .update({ status: `failed_replicate: ${error.message}` })
        .eq('id', selfieId);
      return res.status(500).json({ error: error.message });
    }

    console.log(`[API Generate] Queued ${created.length}/${templates.length} for ${selfieId}:`, created);

    return res.status(200).json({
      status: 'queued',
      selfieId,
      predictionIds: created,
      queued: created.length,
      missing: templates.length - created.length,
      results: existingUrls
    });

  } catch (error) {
    console.error('[API Generate] Unhandled error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
