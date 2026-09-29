require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { GoogleGenAI } = require("@google/genai");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;

// Use one model per request.
// You can change this later using GEMINI_MODEL in .env
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is missing.");
    process.exit(1);
}

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "AI Classroom Tasks Gemini Backend Running",
        model: MODEL
    });
});

function getErrorInfo(error) {
    const message = error?.message || String(error);

    let code = error?.status || error?.code || null;

    if (!code) {
        if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
            code = 429;
        } else if (
            message.includes("503") ||
            message.includes("UNAVAILABLE")
        ) {
            code = 503;
        } else if (
            message.includes("400") ||
            message.includes("INVALID_ARGUMENT")
        ) {
            code = 400;
        } else if (
            message.includes("401") ||
            message.includes("UNAUTHENTICATED")
        ) {
            code = 401;
        } else if (
            message.includes("403") ||
            message.includes("PERMISSION_DENIED")
        ) {
            code = 403;
        }
    }

    return {
        code: Number(code) || 500,
        message
    };
}

async function generateWithRetry(prompt) {
    let lastError;

    // Only retry temporary server overload.
    // Do NOT retry 429 quota errors.
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            console.log(`Gemini request: ${MODEL} - attempt ${attempt}`);

            const response = await ai.models.generateContent({
                model: MODEL,
                contents: prompt
            });

            console.log(`Gemini success: ${MODEL}`);

            return response.text;

        } catch (error) {
            lastError = error;

            const info = getErrorInfo(error);

            console.error(
                `Gemini ${MODEL} failed - ${info.code}:`,
                info.message
            );

            // Quota exceeded.
            // Do not make more requests.
            if (info.code === 429) {
                throw error;
            }

            // Temporary Gemini/server overload.
            if (info.code === 503 && attempt < 2) {
                console.log("Temporary Gemini overload. Retrying once...");
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
            }

            throw error;
        }
    }

    throw lastError;
}

app.post("/api/gemini", async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
            return res.status(400).json({
                success: false,
                error: "Prompt is required."
            });
        }

        const text = await generateWithRetry(prompt);

        return res.json({
            success: true,
            model: MODEL,
            text: text
        });

    } catch (error) {
        const info = getErrorInfo(error);

        console.error("Gemini Error:", info.message);

        if (info.code === 429) {
            return res.status(429).json({
                success: false,
                error:
                    "Gemini API quota has been exceeded for this project/model. " +
                    "Please wait for the quota reset or use a model with available quota.",
                details: info.message
            });
        }

        if (info.code === 503) {
            return res.status(503).json({
                success: false,
                error:
                    "Gemini is temporarily overloaded. Please try again in a moment.",
                details: info.message
            });
        }

        if (info.code === 401 || info.code === 403) {
            return res.status(info.code).json({
                success: false,
                error:
                    "Gemini API authentication or permission error. Check your API key and Google AI Studio project.",
                details: info.message
            });
        }

        return res.status(500).json({
            success: false,
            error: "Gemini API request failed.",
            details: info.message
        });
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Gemini backend running on port ${PORT}`);
    console.log(`Using model: ${MODEL}`);
});