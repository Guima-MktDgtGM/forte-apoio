import Replicate from 'replicate';

const replicateToken = process.env.REPLICATE_API_TOKEN;

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!replicateToken) {
    return res.status(500).json({ error: "REPLICATE_API_TOKEN is not configured on Vercel" });
  }

  try {
    const replicate = new Replicate({ auth: replicateToken });

    // Use a fixed template and the user's latest selfie for testing
    const selfieUrl = "https://gnlfponjvwrdeyimgjzb.supabase.co/storage/v1/object/public/selfies/efd387ad-5d17-46e2-a3ac-f9451e32348b.jpg";
    const templateUrl = "https://forte-apoio.vercel.app/imagens/exemplo-lula-1-m.jpg.jpeg";

    console.log("[Test API] Running codeplugtech/face-swap...");
    let codeplugOutput = null;
    let codeplugError = null;
    try {
      codeplugOutput = await replicate.run(
        "codeplugtech/face-swap:278a81e7ebb22db98bcba54de985d22cc1abeead2754eb1f2af717247be69b34",
        {
          input: {
            swap_image: selfieUrl,
            input_image: templateUrl
          }
        }
      );
    } catch (e) {
      codeplugError = e.message || e;
    }

    console.log("[Test API] Running cdingram/face-swap...");
    let cdingramOutput = null;
    let cdingramError = null;
    try {
      cdingramOutput = await replicate.run(
        "cdingram/face-swap:d1d6ea8c8be89d664a07a457526f7128109dee7030fdac424788d762c71ed111",
        {
          input: {
            swap_image: selfieUrl,
            input_image: templateUrl
          }
        }
      );
    } catch (e) {
      cdingramError = e.message || e;
    }

    return res.status(200).json({
      status: "complete",
      inputs: {
        selfieUrl,
        templateUrl
      },
      codeplug: {
        output: codeplugOutput,
        error: codeplugError
      },
      cdingram: {
        output: cdingramOutput,
        error: cdingramError
      }
    });

  } catch (err) {
    console.error("[Test API] Global error:", err);
    return res.status(500).json({ error: err.message || err });
  }
};
