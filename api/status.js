import { createClient } from '@supabase/supabase-js';
import { finalizarFoto } from '../lib/finalizar.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const replicateToken = process.env.REPLICATE_API_TOKEN;

function extractUrl(output) {
  if (!output) return null;
  const value = Array.isArray(output) ? output[0] : output;
  return typeof value === 'string' ? value : null;
}

async function lerPrediction(id) {
  const r = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    headers: { Authorization: `Bearer ${replicateToken}` }
  });
  if (!r.ok) throw new Error(`Replicate HTTP ${r.status} ao ler ${id}`);
  return r.json();
}

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { selfieId, predictionIds } = req.body || {};

    if (!selfieId || !Array.isArray(predictionIds) || predictionIds.length === 0) {
      return res.status(400).json({ error: 'Missing selfieId or predictionIds' });
    }

    if (!replicateToken) {
      return res.status(500).json({ error: 'Replicate token not set' });
    }

    const predictions = await Promise.all(predictionIds.map(lerPrediction));

    const failed = predictions.find((p) => p.status === 'failed' || p.status === 'canceled');
    if (failed) {
      console.error(`[API Status] Prediction ${failed.id} ${failed.status}:`, failed.error);
      await supabase
        .from('selfies')
        .update({ status: `failed_replicate: ${failed.error || failed.status}` })
        .eq('id', selfieId);

      return res.status(200).json({ status: 'failed', error: failed.error || `Prediction ${failed.status}` });
    }

    const prontas = predictions.filter((p) => p.status === 'succeeded');

    if (prontas.length < predictions.length) {
      return res.status(200).json({
        status: 'processing',
        ready: prontas.length,
        total: predictions.length
      });
    }

    // Todas terminaram. O webhook normalmente ja salvou tudo; se algum webhook
    // se perdeu, finalizamos aqui. finalizarFoto e idempotente (o caminho vem do
    // id da prediction), entao rodar de novo nao duplica foto nenhuma.
    const finais = [];
    for (const p of prontas) {
      const outputUrl = extractUrl(p.output);
      if (!outputUrl) continue;
      try {
        const entrada = p.input || {};
        const imagens = Array.isArray(entrada.image_input) ? entrada.image_input : [];
        finais.push(await finalizarFoto({
          selfieId,
          predictionId: p.id,
          outputUrl,
          inputImageUrl: imagens[0] || entrada.input_image,
          selfieUrl: imagens[1] || entrada.swap_image
        }));
      } catch (e) {
        console.error(`[API Status] Falha ao finalizar ${p.id}:`, e.message);
      }
    }

    if (finais.length === 0) {
      return res.status(200).json({ status: 'failed', error: 'Nenhuma foto pode ser finalizada' });
    }

    // Junta com o que ja estava salvo (o webhook escreve na mesma coluna)
    const { data: atual } = await supabase
      .from('selfies')
      .select('result_url')
      .eq('id', selfieId)
      .single();

    const guardadas = atual && atual.result_url ? atual.result_url.split(',').filter(Boolean) : [];
    const todas = finais.slice();
    guardadas.forEach((u) => { if (!todas.includes(u)) todas.push(u); });

    const { error: updateError } = await supabase
      .from('selfies')
      .update({ result_url: todas.join(',') })
      .eq('id', selfieId);

    if (updateError) console.error('[API Status] Failed to save results:', updateError);

    console.log(`[API Status] ${selfieId} pronto com ${todas.length} fotos`);

    return res.status(200).json({ status: 'ready', results: todas });

  } catch (error) {
    console.error('[API Status] Unhandled error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
