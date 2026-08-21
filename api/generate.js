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

// Free preview: only the 3 photos shown on the result screen are generated before payment.
// Photos 4 and 5 are only generated after the customer buys the 5 photo package.
const PREVIEW_PHOTO_COUNT = 3;
const FULL_PHOTO_COUNT = 5;

const MODEL_VERSION = process.env.REPLICATE_MODEL_VERSION || 'd1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111';

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

    console.log(`[API Generate] Starting ${extra ? 'EXTRA' : 'PREVIEW'} generation for selfie ID: ${selfieId}`);

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

    const existingUrls = selfieRecord.result_url ? selfieRecord.result_url.split(',').filter(Boolean) : [];

    // ------------------------------------------------------------------
    // MODE A: EXTRA — photos 4 and 5, fired after the customer paid.
    // Replicate calls /api/replicate-hook when each one finishes, and that
    // endpoint appends the URL to result_url so obrigado.html picks it up.
    // ------------------------------------------------------------------
    if (extra) {
      // Never generate more than the customer actually bought
      const targetCount = Math.min(Number(target) || FULL_PHOTO_COUNT, FULL_PHOTO_COUNT);

      if (existingUrls.length >= targetCount) {
        console.log(`[API Generate] Photos already complete for ${selfieId} (${existingUrls.length}/${targetCount})`);
        return res.status(200).json({ status: 'success', results: existingUrls });
      }

      const templates = buildTemplateUrls(selfieRecord.candidate, existingUrls.length + 1, targetCount);
      const hookUrl = `${SITE_URL}/api/replicate-hook?selfieId=${encodeURIComponent(selfieId)}`;

      const created = await Promise.all(
        templates.map((templateUrl) =>
          replicate.predictions.create({
            version: MODEL_VERSION,
            input: {
              input_image: templateUrl, // the template target base image
              swap_image: sourceImageUrl // the user's selfie
            },
            webhook: hookUrl,
            webhook_events_filter: ['completed']
          })
        )
      );

      console.log(`[API Generate] Queued ${created.length} extra photos for ${selfieId}:`, created.map((p) => p.id));

      return res.status(200).json({
        status: 'queued',
        predictionIds: created.map((p) => p.id)
      });
    }

    // ------------------------------------------------------------------
    // MODE B: PREVIEW — the 3 watermarked photos shown before checkout
    // ------------------------------------------------------------------

    // If already generated, return the existing URLs right away
    if (existingUrls.length > 0) {
      console.log(`[API Generate] Results already exist in DB for ${selfieId}`);
      return res.status(200).json({ status: 'success', results: existingUrls });
    }

    const templates = buildTemplateUrls(selfieRecord.candidate, 1, PREVIEW_PHOTO_COUNT);
    console.log(`[API Generate] Queueing ${templates.length} face swaps for ${selfieId}. Templates:`, templates);

    // The same webhook used for the extra photos is attached here as a safety
    // net: if the visitor closes the tab or the browser gives up polling, the
    // finished photos still land in Supabase and are delivered after payment.
    const previewHookUrl = `${SITE_URL}/api/replicate-hook?selfieId=${encodeURIComponent(selfieId)}`;

    // Fire all predictions in parallel WITHOUT waiting for them to finish.
    // A face swap takes 50s (warm) to 4min (cold boot) and no serverless
    // function survives that, so the browser polls /api/status instead.
    let created;
    try {
      created = await Promise.all(
        templates.map((templateUrl) =>
          replicate.predictions.create({
            version: MODEL_VERSION,
            input: {
              input_image: templateUrl,
              swap_image: sourceImageUrl
            },
            webhook: previewHookUrl,
            webhook_events_filter: ['completed']
          })
        )
      );
    } catch (e) {
      console.error('[API Generate] Failed to queue predictions:', e);
      // Persist the exact error message in the Supabase status column for remote debugging
      await supabase
        .from('selfies')
        .update({ status: `failed_replicate: ${e.message}` })
        .eq('id', selfieId);
      return res.status(500).json({ error: e.message });
    }

    const predictionIds = created.map((p) => p.id);
    console.log(`[API Generate] Queued predictions for ${selfieId}:`, predictionIds);

    return res.status(200).json({
      status: 'queued',
      selfieId,
      predictionIds
    });

  } catch (error) {
    console.error('[API Generate] Unhandled error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
