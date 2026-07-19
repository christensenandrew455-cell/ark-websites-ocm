import { NextResponse } from "next/server";
import { getAdminAuth } from "../../lib/firebase-admin";
import { HELP_KNOWLEDGE, HELP_LINKS } from "../../lib/helpContent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_LINKS = new Map(HELP_LINKS.map((link) => [link.href, link.label]));
const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 1500;
const FALLBACK_ANSWER = "Sorry, I can’t find any information on that. Open Requests and submit a Request a Change explaining what you are having difficulty with. You can also open Docs and look through the full guide yourself.";
const FALLBACK_LINKS = [
  { href: "/messages", label: "Requests" },
  { href: "/docs", label: "Docs" },
];

async function requireUser(request) {
  const authorization = String(request.headers.get("authorization") || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return { response: NextResponse.json({ error: "Sign in to use AI help." }, { status: 401 }) };

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(token);
    return { decodedToken };
  } catch (error) {
    console.error("Unable to verify help-chat user", error);
    return { response: NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 }) };
  }
}

function cleanMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: String(message.text || message.content || "").trim().slice(0, MAX_MESSAGE_LENGTH),
    }))
    .filter((message) => message.content);
}

function cleanLinks(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 4).flatMap((link) => {
    const href = String(link?.href || "").trim();
    if (!ALLOWED_LINKS.has(href) || seen.has(href)) return [];
    seen.add(href);
    return [{ href, label: ALLOWED_LINKS.get(href) }];
  });
}

function fallbackResponse() {
  return NextResponse.json({ answer: FALLBACK_ANSWER, links: FALLBACK_LINKS });
}

export async function POST(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;

  try {
    const body = await request.json();
    const messages = cleanMessages(body.messages);
    const currentPath = String(body.currentPath || "/").slice(0, 200);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return NextResponse.json({ error: "Ask a question about the app." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI help is not configured yet. Open Docs for help." }, { status: 503 });
    }

    const model = String(process.env.OPENAI_HELP_MODEL || "gpt-4o-mini").trim();
    const systemPrompt = `You are the built-in help assistant for ARK Client Center. Your only job is to explain how this app works and direct signed-in customers to the correct page. Be friendly, direct, and brief. Use only the documentation below. Never invent features, prices, policy promises, account status, request status, or customer data. Never claim that you performed an action. You cannot edit accounts, billing, clients, requests, or policies. When an action is needed, explain the steps and provide the correct page link. Refer to links by their actual page names, such as Clients, Settings, Requests, Docs, Terms of Use, or Privacy Policy.

If the documentation does not clearly answer the question, do not guess. Set "found" to false. The application will then tell the user to submit a Request a Change and review Docs.

Return valid JSON only in this exact shape:
{"found":true,"answer":"A plain-language answer under 160 words.","links":[{"label":"Exact allowed label","href":"Exact allowed href"}]}

Use no more than three links. Only use these exact links:
${HELP_LINKS.map((link) => `- ${link.label}: ${link.href}`).join("\n")}

Current page: ${currentPath}

DOCUMENTATION:
${HELP_KNOWLEDGE}`;

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
    });

    const openAiData = await openAiResponse.json().catch(() => ({}));
    if (!openAiResponse.ok) {
      console.error("OpenAI help request failed", openAiData);
      return NextResponse.json({ error: "AI help is temporarily unavailable. Open Docs or try again." }, { status: 502 });
    }

    const rawContent = openAiData?.choices?.[0]?.message?.content || "";
    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = { found: false, answer: "", links: [] };
    }

    const answer = String(parsed?.answer || "").trim();
    const answerSoundsUnknown = /(?:can(?:not|'t)|could(?: not|n't)) find|do not know|don't know|not in (?:the )?(?:docs|documentation)|no information/i.test(answer);
    if (parsed?.found === false || !answer || answerSoundsUnknown) {
      return fallbackResponse();
    }

    return NextResponse.json({ answer: answer.slice(0, 2500), links: cleanLinks(parsed?.links) });
  } catch (error) {
    console.error("Unable to answer help question", error);
    return NextResponse.json({ error: "AI help could not answer right now. Open Docs or try again." }, { status: 500 });
  }
}
