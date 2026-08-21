import { createClient } from '@supabase/supabase-js';
import Replicate from 'replicate';

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize Replicate
const replicateToken = process.env.REPLICATE_API_TOKEN;
const replicate = replicateToken ? new Replicate({ auth: replicateToken }) : null;

// Public site URL: Replicate needs to download the template images from here
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://forte-apoio.vercel.app';

// Free preview: only the 3 photos shown on the result screen are generated before
// payment. Photos 4 and 5 come later, after the 5 photo package is bought.
const PREVIEW_PHOTO_COUNT = 3;
const FULL_PHOTO_COUNT = 5;

const MODEL_VERSION = process.env.REPLICATE_MODEL_VERSION || 'd1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111';

// Below $5 of credit Replicate throttles prediction creation to a burst of 1,
// so predictions have to be created one at a time, retrying on 429. This budget
// keeps the whole thing inside the serverless maxDuration.
const CREATE_BUDGET_MS = 45000;
const DEFAULT_RETRY_AFTER_MS = 11000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Builds the template target URLs for a range of photos (reads candidate and gender, e.g. lula_m, lula_f)
function buildTemplateUrls(dbCandidate, fromIndex, toIndex) {
  const raw = dbCandidate || 'lula';
  const [cand, gender] = raw.includes('_') ? raw.split('_') : [raw, 'm'];
  const genderUpper = gender.toUpperCase();
  const list = [];

  for (let i = fromIndex; i <= toIndex; i++) {
    if (cand === 'lula') {
      const customUrl = process.env[`TEMPLATE_LULA_${genderUpper}_${i}`] || process.env[`TEMPLATE_LULA_${i}`];
      list.push(customUrl || `${SITE_URL}/imagens/exemplo-lula-${i}-${gender}.jpg.jpeg`);
    } else {
      const customUrl = process.env[`TEMPLATE_BOLSONARO_${genderUpper}_${i}`] || process.env[`TEMPLATE_BOLSONARO_${i}`];
      list.push(customUrl || `${SITE_URL}/imagens/exemplo-bolsonaro-${i}-${gender}.png.jpeg`);
    }
  }

  return list;
}

// Reads the "retry_after" the Replicate API asks for, in milliseconds
function retryAfterMs(error) {
  const raw = String(error && error.message ? error.message : error);
  const match = raw.match(/"retry_after"\s*:\s*(\d+)/);
  if (match) return (parseInt(match[1], 10) + 1) * 1000;
  return DEFAULT_RETRY_AFTER_MS;
}

function isThrottled(error) {
  if (!error) return false;
  if (error.response && error.response.status === 429) return true;
  return String(error.message || error).includes('429');
}

// Creates the predictions ONE AT A TIME, waiting out any 429 throttle.
// Returns whatever it managed to create before the time budget runs out —
// the browser calls this endpoint again for the rest.
async function createPredictionsSequentially(templates, sourceImageUrl, hookUrl) {
  const deadline = Date.now() + CREATE_BUDGET_MS;
  const created = [];
  let lastError = null;

  for (const templateUrl of templates) {
    let placed = false;

    while (!placed && Date.now() < deadline) {
      try {
        const prediction = await replicate.predictions.create({
          version: MODEL_VERSION,
          input: {
            input_image: templateUrl, // the template target base image
            swap_image: sourceImageUrl // the user's selfie
          },
          webhook: hookUrl,
          webhook_events_filter: ['completed']
        });

        created.push(prediction.id);
        placed = true;
      } catch (e) {
        lastError = e;

        if (!isThrottled(e)) {
          console.error('[API Generate] Non-throttle error creating prediction:', e);
          return { created, error: e };
        }

        const waitMs = retryAfterMs(e);
        if (Date.now() + waitMs >= deadline) {
          console.warn('[API Generate] Throttled and out of time budget. Returning partial batch.');
          return { created, error: null };
        }

        console.log(`[API Generate] Throttled by Replicate (low credit). Waiting ${waitMs}ms before retrying.`);
        await sleep(waitMs);
      }
    }

    if (!placed) break;
  }

  return { created, error: created.length === 0 ? lastError : null };
}

export default async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { selfieId, extra, target } = req.body || {};
    if (!selfieId) {
      return res.status(400).json({ error: 'Missing selfieId' });
    }

    if (!replicate) {
      console.error('[API Generate] Replicate client not configured. Set REPLICATE_API_TOKEN.');
      return res.status(500).json({ error: 'Replicate token not set' });
    }

    // 1. Fetch record from Supabase
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
      console.error(`[API Generate] Missing selfie_url in DB record for ${selfieId}`);
      return res.status(400).json({ error: 'DB record is missing selfie_url' });
    }

    // Photos already finished and stored (the Replicate webhook appends them here)
    const existingUrls = selfieRecord.result_url ? selfieRecord.result_url.split(',').filter(Boolean) : [];

    // How many photos this call should end up with
    const wanted = extra
      ? Math.min(Number(target) || FULL_PHOTO_COUNT, FULL_PHOTO_COUNT)
      : PREVIEW_PHOTO_COUNT;

    console.log(`[API Generate] ${extra ? 'EXTRA' : 'PREVIEW'} for ${selfieId}: ${existingUrls.length}/${wanted} done`);

    if (existingUrls.length >= wanted) {
      return res.status(200).json({ status: 'success', results: existingUrls });
    }

    // Only queue the photos that are still missing — this makes the endpoint
    // safe to call again when the throttle only let part of the batch through.
    const templates = buildTemplateUrls(selfieRecord.candidate, existingUrls.length + 1, wanted);
    const hookUrl = `${SITE_URL}/api/replicate-hook?selfieId=${encodeURIComponent(selfieId)}`;

    console.log(`[API Generate] Queueing ${templates.length} face swaps for ${selfieId}. Templates:`, templates);

    // Fire the predictions WITHOUT waiting for the AI to finish. A face swap
    // takes 50s (warm) to 4min (cold boot) and no serverless function survives
    // that, so the browser polls /api/status instead.
    const { created, error } = await createPredictionsSequentially(templates, sourceImageUrl, hookUrl);

    if (error && created.length === 0) {
      console.error('[API Generate] Failed to queue any prediction:', error);
      // Persist the exact error message in the Supabase status column for remote debugging
      await supabase
        .from('selfies')
        .update({ status: `failed_replicate: ${error.message || error}` })
        .eq('id', selfieId);
      return res.status(500).json({ error: error.message || String(error) });
    }

    console.log(`[API Generate] Queued ${created.length}/${templates.length} predictions for ${selfieId}:`, created);

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
