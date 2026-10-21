
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

type Mode = "quick" | "technical" | "professional";
type EntryStatus = "thinking" | "ready" | "error";
type SpeechStatus = "unsupported" | "idle" | "listening" | "stopped";

type Entry = {
  id: number;
  question: string;
  answer?: string;
  status: EntryStatus;
  error?: string;
};

function extractQuestion(text: string): string | null {
  const value = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s,.;:!?-]+/, "");

  if (value.length < 8) return null;

  // Find question phrases even if greetings or filler words come first.
  const pattern =
    /\b(?:who|what|when|where|why|how|which|whose|whom|can|could|would|will|should|do|does|did|is|are|am|was|were|have|has|had|may|might|explain|describe|tell me|please explain)\b/gi;

  const matches = [...value.matchAll(pattern)];

  if (matches.length === 0) {
    if (value.endsWith("?")) return value.slice(0, 500);
    return null;
  }

  // Use the last question opener, helping with repeated speech results.
  const match = matches[matches.length - 1];
  if (match.index === undefined) return null;

  let candidate = value.slice(match.index).trim();

  // Remove a trailing repeated greeting/question prefix if speech
  // recognition has duplicated a phrase.
  candidate = candidate.replace(/\s+/g, " ").trim();

  if (candidate.length < 8) return null;

  // Avoid sending an entire long meeting transcript as one question.
  candidate = candidate.slice(0, 500);

  return candidate;
}

export default function App() {
  const [question, setQuestion] = useState("");
  const [profile, setProfile] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("quick");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [speechStatus, setSpeechStatus] =
    useState<SpeechStatus>("idle");
  const [error, setError] = useState("");
  const [permissionHelp, setPermissionHelp] = useState("");
  const [autoAnswers, setAutoAnswers] = useState(true);
  const [busyCount, setBusyCount] = useState(0);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldRestartRef = useRef(false);
  const nextIdRef = useRef(1);
  const questionCacheRef = useRef<string[]>([]);
  const modeRef = useRef<Mode>(mode);
  const transcriptRef = useRef("");
  const speechBufferRef = useRef("");
  const questionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const askAI = useCallback(async (text: string) => {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (normalized.length < 3) return;

    const key = normalized
      .toLowerCase()
      .replace(/[?.!,]+$/g, "")
      .trim();

    // Avoid asking the same question repeatedly.
    if (questionCacheRef.current.includes(key)) return;

    questionCacheRef.current = [
      ...questionCacheRef.current.slice(-29),
      key,
    ];

    const id = nextIdRef.current++;

    const newEntry: Entry = {
      id,
      question: normalized,
      status: "thinking",
    };

    setEntries((old) => [newEntry, ...old].slice(0, 12));
    setBusyCount((n) => n + 1);

    try {
      const response = await fetch(`${API_URL}/api/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: normalized,
          mode: modeRef.current,
          context: transcriptRef.current.slice(-1800),
          profile: profile.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || `Request failed (${response.status})`
        );
      }

      if (typeof data.answer !== "string" || !data.answer.trim()) {
        throw new Error("The AI provider returned an empty answer.");
      }

      setEntries((old) =>
        old.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                answer: data.answer,
                status: "ready",
              }
            : entry
        )
      );
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Could not generate an answer.";

      setEntries((old) =>
        old.map((entry) =>
          entry.id === id
            ? { ...entry, status: "error", error: message }
            : entry
        )
      );
    } finally {
      setBusyCount((n) => Math.max(0, n - 1));
    }
  }, []);

  const processSpeechBuffer = useCallback(() => {
    const buffered = speechBufferRef.current.trim();

    if (!buffered || !autoAnswers) return;

    const detected = extractQuestion(buffered);

    if (detected) {
      void askAI(detected);
    }
  }, [autoAnswers, askAI]);

  const addFinalSpeech = useCallback(
    (spokenText: string) => {
      const cleaned = spokenText.trim();
      if (!cleaned) return;

      transcriptRef.current = (
        `${transcriptRef.current} ${cleaned}`
      )
        .trim()
        .slice(-5000);

      setTranscript(transcriptRef.current);

      // Combine nearby speech segments so that a question split by
      // the browser can still be detected as one phrase.
      speechBufferRef.current = (
        `${speechBufferRef.current} ${cleaned}`
      )
        .trim()
        .slice(-1000);

      if (questionTimerRef.current) {
        clearTimeout(questionTimerRef.current);
      }

      // Wait briefly for the next speech segment before detection.
      questionTimerRef.current = setTimeout(() => {
        processSpeechBuffer();
        speechBufferRef.current = "";
        questionTimerRef.current = null;
      }, 1200);
    },
    [processSpeechBuffer]
  );

  const startListening = () => {
    setError("");
    setPermissionHelp("");

    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setSpeechStatus("unsupported");
      setError(
        "Live speech recognition is not supported in this browser. " +
          "Try Chrome on Android or use the manual question box."
      );
      return;
    }

    try {
      const recognition = new SpeechRecognitionAPI();

      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setSpeechStatus("listening");
        setError("");
      };

      recognition.onresult = (event) => {
        let interimText = "";

        for (
          let i = event.resultIndex;
          i < event.results.length;
          i++
        ) {
          const result = event.results[i];
          const spoken = result[0]?.transcript?.trim() || "";

          if (result.isFinal) {
            addFinalSpeech(spoken);
          } else {
            interimText += `${spoken} `;
          }
        }

        setInterim(interimText.trim());
      };

      recognition.onerror = (event) => {
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        ) {
          shouldRestartRef.current = false;
          setSpeechStatus("stopped");
          setPermissionHelp(
            "Microphone or speech permission was denied. " +
              "Allow access in your browser's site settings and try again."
          );
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          setError(
            `Speech recognition issue: ${event.error}. ` +
              "You can still type a question below."
          );
        }
      };

      recognition.onend = () => {
        if (shouldRestartRef.current) {
          try {
            recognition.start();
          } catch {
            // The browser may reject an immediate restart.
          }
        } else {
          setSpeechStatus("stopped");
        }
      };

      recognitionRef.current = recognition;
      shouldRestartRef.current = true;
      recognition.start();
    } catch {
      shouldRestartRef.current = false;
      setSpeechStatus("stopped");
      setError(
        "Could not start speech recognition. Check browser permissions."
      );
    }
  };

  const stopListening = () => {
    shouldRestartRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;

    if (questionTimerRef.current) {
      clearTimeout(questionTimerRef.current);
      questionTimerRef.current = null;
      processSpeechBuffer();
    }

    speechBufferRef.current = "";
    setSpeechStatus("stopped");
    setInterim("");
  };

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      recognitionRef.current?.abort();

      if (questionTimerRef.current) {
        clearTimeout(questionTimerRef.current);
      }
    };
  }, []);

  const clearSession = () => {
    shouldRestartRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;

    if (questionTimerRef.current) {
      clearTimeout(questionTimerRef.current);
      questionTimerRef.current = null;
    }

    speechBufferRef.current = "";
    transcriptRef.current = "";

    setSpeechStatus("stopped");
    setTranscript("");
    setInterim("");
    setEntries([]);
    setQuestion("");
    setError("");
    setPermissionHelp("");
    questionCacheRef.current = [];
  };

  const uploadResume = async (file?: File) => {
    if (!file) return;
    setProfileStatus("");
    setProfileBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API_URL}/api/profile/extract`, {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not read resume.");
      setProfile((old) => [old.trim(), data.text].filter(Boolean).join("\\n\\n"));
      setProfileStatus(`Imported text from ${file.name}. Review it below before listening.`);
    } catch (e) {
      setProfileStatus(e instanceof Error ? e.message : "Resume import failed.");
    } finally {
      setProfileBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">M</div>
        <div className="brand-copy">
          <h1>Meeting Copilot</h1>
          <p>Live listening · Suggested answers</p>
        </div>
        <span
          className={`status-pill ${
            speechStatus === "listening" ? "active" : ""
          }`}
        >
          <span className="status-dot" />
          {speechStatus === "listening" ? "Listening" : "Ready"}
        </span>
      </header>

      <section className="hero">
        <span className="eyebrow">YOUR PERSONAL MEETING ASSISTANT</span>
        <h2>
          Listen carefully.
          <br />
          <span>Respond confidently.</span>
        </h2>
        <p>
          Capture speech with your permission, detect likely questions,
          and review AI-suggested answers on your phone.
        </p>
      </section>

      <section className="privacy-note" role="note">
        <span className="note-icon">ⓘ</span>
        <div>
          <strong>Permission and privacy</strong>
          <p>
            Tap Start Listening to trigger the browser's permission flow.
            Use this only when participants and your organization permit it.
            Speech recognition may send audio to the browser provider.
            This app does not save audio recordings.
          </p>
        </div>
      </section>

      <section className="card profile-card">
        <div className="section-heading">
          <div>
            <span className="section-kicker">01 / YOUR CONTEXT</span>
            <h3>Personalize your answers</h3>
          </div>
          <span className="mic-icon">✦</span>
        </div>
        <p className="small-note profile-intro">
          Add a resume, professional bio, or keywords. The AI uses this context
          to tailor suggestions. Only include information you are comfortable sending
          to your configured AI provider.
        </p>
        <label className="field-label" htmlFor="resume-upload">Import resume (PDF, DOCX, or TXT; max 5 MB)</label>
        <input
          id="resume-upload"
          className="file-field"
          type="file"
          accept=".pdf,.docx,.txt"
          disabled={profileBusy}
          onChange={(event) => {
            void uploadResume(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        {profileBusy && <p className="profile-status">Reading resume…</p>}
        {profileStatus && <p className="profile-status" role="status">{profileStatus}</p>}
        <label className="field-label" htmlFor="profile-context">Bio, experience, skills, projects, and keywords</label>
        <textarea
          id="profile-context"
          rows={6}
          maxLength={12000}
          value={profile}
          onChange={(event) => setProfile(event.target.value)}
          placeholder="Example: ServiceNow trainee; learning CMDB, ITOM, Discovery. Project experience: ... Skills I can confidently discuss: ..."
        />
        <div className="profile-actions">
          <span className="small-note">{profile.length}/12000 characters · Used for answers in this session</span>
          <button className="secondary-button" onClick={() => { setProfile(""); setProfileStatus("Profile cleared."); }}>
            Clear profile
          </button>
        </div>
      </section>

      <section className="card listening-card">
        <div className="section-heading">
          <div>
            <span className="section-kicker">02 / AUDIO</span>
            <h3>Live listening</h3>
          </div>
          <span className="mic-icon">🎙</span>
        </div>

        <div className="listening-state">
          <span
            className={`pulse ${
              speechStatus === "listening" ? "pulse-on" : ""
            }`}
          />
          <div>
            <strong>
              {speechStatus === "listening"
                ? "Microphone listening is active"
                : "Listening is off"}
            </strong>
            <p>
              {speechStatus === "listening"
                ? "Keep this page open and your phone near the meeting speaker."
                : "Start only after confirming permission to process the meeting audio."}
            </p>
          </div>
        </div>

        <div className="button-row">
          {speechStatus === "listening" ? (
            <button
              className="primary-button stop-button"
              onClick={stopListening}
            >
              ■ Stop listening
            </button>
          ) : (
            <button className="primary-button" onClick={startListening}>
              ● Start listening & allow microphone
            </button>
          )}
          <button className="secondary-button" onClick={clearSession}>
            Clear session
          </button>
        </div>

        {permissionHelp && (
          <p className="permission-help">{permissionHelp}</p>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <span className="section-kicker">03 / TRANSCRIPT</span>
            <h3>What the browser heard</h3>
          </div>
          <span className="count-badge">{transcript.length} chars</span>
        </div>

        <div className="transcript-box" aria-live="polite">
          {transcript || (
            <span className="placeholder">
              Finalized speech will appear here when listening is active…
            </span>
          )}
          {interim && <span className="interim"> {interim}</span>}
        </div>

        <p className="small-note">
          Speech recognition accuracy depends on your browser, language,
          connection, and device. Headphones may prevent the phone
          microphone from hearing the meeting's other participants.
        </p>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <span className="section-kicker">04 / ANSWERS</span>
            <h3>Suggested responses</h3>
          </div>
          <span className="count-badge">{entries.length} questions</span>
        </div>

        <label className="field-label" htmlFor="answer-mode">
          Answer style
        </label>
        <select
          id="answer-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className="select-field"
        >
          <option value="quick">Quick answer</option>
          <option value="technical">Technical explanation</option>
          <option value="professional">Professional response</option>
        </select>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={autoAnswers}
            onChange={(e) => setAutoAnswers(e.target.checked)}
          />
          <span>Automatically answer detected questions</span>
        </label>

        <div className="manual-box">
          <label className="field-label" htmlFor="manual-question">
            Ask manually
          </label>
          <textarea
            id="manual-question"
            rows={3}
            maxLength={3000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Type or paste a question here…"
          />
          <button
            className="secondary-button full-width"
            disabled={busyCount > 0 || question.trim().length < 3}
            onClick={() => void askAI(question)}
          >
            {busyCount > 0 ? "Generating…" : "Generate answer"}
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="empty-state">
            <span>✦</span>
            <p>
              Suggested answers will appear here when a likely question
              is detected.
            </p>
          </div>
        ) : (
          <div className="answer-list">
            {entries.map((entry) => (
              <article className="answer-card" key={entry.id}>
                <div className="question-label">DETECTED QUESTION</div>
                <h4>{entry.question}</h4>

                {entry.status === "thinking" && (
                  <p className="thinking">
                    Generating a suggested answer…
                  </p>
                )}

                {entry.status === "error" && (
                  <p className="error-message">{entry.error}</p>
                )}

                {entry.status === "ready" && (
                  <>
                    <div className="answer-label">
                      ✦ SUGGESTED ANSWER
                    </div>
                    <p className="answer-text">{entry.answer}</p>
                    <button
                      className="copy-button"
                      onClick={() => {
                        if (entry.answer && navigator.clipboard) {
                          void navigator.clipboard
                            .writeText(entry.answer)
                            .catch(() => {
                              setError(
                                "Copy failed. Select and copy the answer manually."
                              );
                            });
                        }
                      }}
                    >
                      Copy answer
                    </button>
                  </>
                )}
              </article>
            ))}
          </div>
        )}

        <p className="small-note">
          AI output can be incorrect. Verify answers and use your own
          judgment. Do not rely on AI for confidential or
          security-sensitive decisions.
        </p>
      </section>

      <footer>Meeting Copilot · MVP · No audio recording storage</footer>
    </main>
  );
}
