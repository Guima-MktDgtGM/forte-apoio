import { createClient } from '@supabase/supabase-js';
import Replicate from 'replicate';

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize Replicate
const replicateToken = process.env.REPLICATE_API_TOKEN;
const replicate = replicateToken ? new Replicate({ auth: replicateToken }) : null;

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
    const { selfieId } = req.body;
    if (!selfieId) {
      return res.status(400).json({ error: "Missing selfieId" });
    }

    console.log(`[API Generate] Starting generation for selfie ID: ${selfieId}`);

    // 1. Fetch record from Supabase
    const { data: selfieRecord, error: fetchError } = await supabase
      .from('selfies')
      .select('*')
      .eq('id', selfieId)
      .single();

    if (fetchError || !selfieRecord) {
      console.error(`[API Generate] Selfie record not found for ID: ${selfieId}`, fetchError);
      return res.status(404).json({ error: "Selfie record not found" });
    }

    // If already generated, return the existing URLs
    if (selfieRecord.result_url) {
      console.log(`[API Generate] Results already exist in DB for ${selfieId}`);
      return res.status(200).json({
        status: "success",
        results: selfieRecord.result_url.split(',')
      });
    }

    const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://forteapoio.com.br';
    const sourceImageUrl = selfieRecord.selfie_url;

    if (!sourceImageUrl) {
      console.error(`[API Generate] Missing selfie_url in DB record for ${selfieId}`);
      return res.status(400).json({ error: "DB record is missing selfie_url" });
    }

    if (!replicate) {
      console.error("[API Generate] Replicate client not configured. Set REPLICATE_API_TOKEN.");
      return res.status(500).json({ error: "Replicate token not set" });
    }

    const photoCount = 5; 

    // Resolve templates array (reads candidate and gender, e.g. lula_m, lula_f)
    const templateList = [];
    const dbCandidate = selfieRecord.candidate || 'lula';
    const [cand, gender] = dbCandidate.includes('_') ? dbCandidate.split('_') : [dbCandidate, 'm'];
    
    const modelVersion = process.env.REPLICATE_MODEL_VERSION || "278a81e7ebb22db98bcba54de985d22cc1abeead2754eb1f2af717247be69b34";
    const modelPath = modelVersion.includes('/') ? modelVersion : `codeplugtech/face-swap:${modelVersion}`;

    for (let i = 1; i <= photoCount; i++) {
      const genderUpper = gender.toUpperCase();
      if (cand === 'lula') {
        const customUrl = process.env[`TEMPLATE_LULA_${genderUpper}_${i}`] || process.env[`TEMPLATE_LULA_${i}`];
        templateList.push(customUrl || `${siteUrl}/imagens/exemplo-lula-${i}-${gender}.jpg.jpeg`);
      } else {
        const customUrl = process.env[`TEMPLATE_BOLSONARO_${genderUpper}_${i}`] || process.env[`TEMPLATE_BOLSONARO_${i}`];
        templateList.push(customUrl || `${siteUrl}/imagens/exemplo-bolsonaro-${i}-${gender}.png.jpeg`);
      }
    }

    console.log(`[API Generate] Starting sequential Face Swap for ${photoCount} variations using model: ${modelPath}. Templates:`, templateList);

    // 2. Trigger Replicate Faceswap model sequentially (bypasses the 1-burst limit for low credit accounts)
    let generatedUrls = [];
    try {
      for (let idx = 0; idx < templateList.length; idx++) {
        const templateUrl = templateList[idx];
        console.log(`[API Generate] Triggering Replicate (sequential) for variation #${idx + 1} with target: ${templateUrl}`);
        
        const output = await replicate.run(
          modelPath,
          {
            input: {
              input_image: templateUrl, // the template target base image
              swap_image: sourceImageUrl // the user's selfie
            }
          }
        );
        
        if (output) {
          console.log(`[API Generate] Replicate output for variation #${idx + 1}:`, output);
          const url = Array.isArray(output) ? output[0] : output;
          generatedUrls.push(url);
        } else {
          throw new Error(`Empty output from Replicate on variation #${idx + 1}`);
        }
      }
    } catch (e) {
      console.error("[API Generate] Sequential processing failure:", e);
      // Persist the exact error message in the Supabase status column for remote debugging
      await supabase
        .from('selfies')
        .update({ status: `failed_replicate: ${e.message}` })
        .eq('id', selfieId);
      return res.status(500).json({ error: e.message });
    }

    // Filter out invalid entries
    generatedUrls = generatedUrls.filter(url => url && typeof url === 'string');

    if (generatedUrls.length === 0) {
      return res.status(500).json({ error: "AI output URL list is empty" });
    }

    const resultsCsv = generatedUrls.join(',');
    console.log("[API Generate] Sequential generation complete. Saved CSV:", resultsCsv);

    // 3. Update database with generated image URLs list (keeps status 'pending')
    const { error: updateError } = await supabase
      .from('selfies')
      .update({
        result_url: resultsCsv
      })
      .eq('id', selfieId);

    if (updateError) {
      console.error("[API Generate] Failed to update Supabase record with results:", updateError);
    }

    return res.status(200).json({
      status: "success",
      selfieId,
      resultCount: generatedUrls.length,
      results: generatedUrls
    });

  } catch (error) {
    console.error("[API Generate] Unhandled error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
