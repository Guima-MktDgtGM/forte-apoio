import { createClient } from '@supabase/supabase-js';
import { finalizarFoto } from '../lib/finalizar.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function extractUrl(output) {
  if (!output) return null;
  const value = Array.isArray(output) ? output[0] : output;
  return typeof value === 'string' ? value : null;
}

// Called by Replicate when a face swap finishes. Pastes the politician's real
// face back over the grey rectangle, saves the final photo to Supabase Storage
// (permanent, unlike replicate.delivery URLs which expire) and appends it to
// result_url, which both the result screen and obrigado.html poll.
export default async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const selfieId = req.query.selfieId;
    const prediction = req.body || {};

    if (!selfieId) {
      return res.status(400).json({ error: 'Missing selfieId' });
    }

    console.log(`[Replicate Hook] ${prediction.id} for ${selfieId}: ${prediction.status}`);

    if (prediction.status !== 'succeeded') {
      return res.status(200).json({ status: 'ignored', reason: prediction.status });
    }

    const outputUrl = extractUrl(prediction.output);
    if (!outputUrl) {
      return res.status(200).json({ status: 'ignored', reason: 'empty output' });
    }

    // nano-banana usa image_input: [template, selfie]; o face swap usa input_image
    const entrada = prediction.input || {};
    const imagens = Array.isArray(entrada.image_input) ? entrada.image_input : [];

    const finalUrl = await finalizarFoto({
      selfieId,
      predictionId: prediction.id,
      outputUrl,
      inputImageUrl: imagens[0] || entrada.input_image,
      selfieUrl: imagens[1] || entrada.swap_image
    });

    const { data: record, error: fetchError } = await supabase
      .from('selfies')
      .select('result_url')
      .eq('id', selfieId)
      .single();

    if (fetchError || !record) {
      console.error(`[Replicate Hook] Record not found for ${selfieId}`, fetchError);
      return res.status(404).json({ error: 'Selfie record not found' });
    }

    const urls = record.result_url ? record.result_url.split(',').filter(Boolean) : [];

    if (urls.includes(finalUrl)) {
      return res.status(200).json({ status: 'duplicate', url: finalUrl });
    }

    urls.push(finalUrl);

    const { error: updateError } = await supabase
      .from('selfies')
      .update({ result_url: urls.join(',') })
      .eq('id', selfieId);

    if (updateError) {
      console.error('[Replicate Hook] Failed to append result:', updateError);
      return res.status(500).json({ error: 'Failed to save result' });
    }

    console.log(`[Replicate Hook] photo ${urls.length} saved for ${selfieId}`);

    return res.status(200).json({ status: 'success', total: urls.length, url: finalUrl });

  } catch (error) {
    console.error('[Replicate Hook] Unhandled error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
