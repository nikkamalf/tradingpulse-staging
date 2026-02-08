export default async function handler(request, response) {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

    if (!GITHUB_TOKEN) {
        return response.status(500).json({ error: 'GITHUB_TOKEN not configured in Vercel Environment Variables' });
    }

    try {
        const res = await fetch('https://api.github.com/repos/nikkamalf/gold-tracker/actions/workflows/tracker.yml/dispatches', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'User-Agent': 'Vercel-Cron-Trigger'
            },
            body: JSON.stringify({ ref: 'main' }),
        });

        if (res.ok) {
            return response.status(200).json({ success: true, message: 'GitHub workflow triggered successfully' });
        } else {
            const errorText = await res.text();
            return response.status(res.status).json({ success: false, error: `GitHub API error: ${errorText}` });
        }
    } catch (error) {
        return response.status(500).json({ success: false, error: error.message });
    }
}
