import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function extractUrl(output) {
  if (!output) return null;
  const value = Array.isArray(output) ? output[0] : output;
  return typeof value === 'string' ? value : null;
}

// Called by Replicate when an EXTRA photo (4 and 5, generated after payment)
// finishes. Appends the new URL to result_url so obrigado.html, which already
// polls Supabase every 3s, releases the download on its own.
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

    const newUrl = extractUrl(prediction.output);
    if (!newUrl) {
      return res.status(200).json({ status: 'ignored', reason: 'empty output' });
    }

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

    if (urls.includes(newUrl)) {
      return res.status(200).json({ status: 'duplicate' });
    }

    urls.push(newUrl);

    const { error: updateError } = await supabase
      .from('selfies')
      .update({ result_url: urls.join(',') })
      .eq('id', selfieId);

    if (updateError) {
      console.error('[Replicate Hook] Failed to append result:', updateError);
      return res.status(500).json({ error: 'Failed to save result' });
    }

    console.log(`[Replicate Hook] Appended photo ${urls.length} for ${selfieId}`);

    return res.status(200).json({ status: 'success', total: urls.length });

  } catch (error) {
    console.error('[Replicate Hook] Unhandled error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
