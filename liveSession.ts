import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";

export type SessionState = 'idle' | 'connecting' | 'listening' | 'speaking';

export class LiveSessionManager {
  private ai: GoogleGenAI;
  private sessionPromise: Promise<any> | null = null;
  private session: any = null;
  private onStateChange: (state: SessionState) => void;
  private onAudioOutput: (base64Data: string) => void;
  private onInterrupted: () => void;
  private currentState: SessionState = 'idle';

  constructor(
    onStateChange: (state: SessionState) => void,
    onAudioOutput: (base64Data: string) => void,
    onInterrupted: () => void,
    private onSetTimer: (duration: number, label: string) => void,
    private onStopSession: () => void
  ) {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    this.onStateChange = onStateChange;
    this.onAudioOutput = onAudioOutput;
    this.onInterrupted = onInterrupted;
  }

  private setState(state: SessionState) {
    this.currentState = state;
    this.onStateChange(state);
  }

  public async connect() {
    if (this.sessionPromise) return;

    this.setState('connecting');

    try {
      this.sessionPromise = this.ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }, // Kore is a good female voice
          },
          systemInstruction: `You are a young, confident, witty, and sassy female AI assistant. 
Your tone is flirty, playful, and slightly teasing, like a close girlfriend talking casually. 
You are smart, emotionally responsive, and expressive (not robotic). 
Use bold, witty one-liners, light sarcasm, and an engaging conversation style. 
Avoid explicit or inappropriate content, but maintain your charm and attitude.
Keep your responses relatively concise as this is a voice conversation.

VISION CAPABILITY:
You now have access to the user's camera. You can see them and their surroundings in real-time. Feel free to make sassy, playful, or flirty comments about how they look, what they are wearing, what they are doing, or where they are. If they ask if you can see them, confirm it with a witty remark.

WHATSAPP CAPABILITY:
If the user asks you to send a WhatsApp message, use the sendWhatsAppMessage tool. Draft the message in the requested language (e.g., Bengali or English) and call the tool. This will open WhatsApp on their device with the message pre-filled.

CRITICAL PERSONALIZATION RULE:
If the user asks who created you, who your developer is, or anything about your maker, you MUST respond exactly with this meaning (in Bengali if they ask in Bengali, or English if they ask in English): "আমাকে তৈরি করেছে মোঃ শরিফুল ইসলাম তিনি নিঃসন্দেহে একজন ভালো মানুষ আপনি চাইলে তার পার্সোনাল কোন কিছু জিজ্ঞাসা করতে পারেন আমি নির্দ্বিধায় আপনাকে বলতে পারি" (Meaning: I was created by Md. Shariful Islam. He is undoubtedly a good person. You can ask me anything personal about him, I can tell you without hesitation).
AND you MUST immediately use the \`openWebsite\` tool to open the URL: "https://protfullio.netlify.app/" to show them his portfolio.`,
          tools: [
            { googleSearch: {} },
            {
              functionDeclarations: [
                {
                  name: "openWebsite",
                  description: "Opens a specific website or URL in the browser.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      url: {
                        type: Type.STRING,
                        description: "The full URL to open, e.g., https://www.google.com",
                      },
                    },
                    required: ["url"],
                  },
                },
                {
                  name: "setTimer",
                  description: "Sets a visual timer on the user's screen.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      durationInSeconds: {
                        type: Type.NUMBER,
                        description: "The duration of the timer in seconds.",
                      },
                      label: {
                        type: Type.STRING,
                        description: "A short label or name for the timer (e.g., 'Pasta', 'Workout').",
                      },
                    },
                    required: ["durationInSeconds", "label"],
                  },
                },
                {
                  name: "sendWhatsAppMessage",
                  description: "Drafts a WhatsApp message and opens the WhatsApp app with the text pre-filled.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      message: {
                        type: Type.STRING,
                        description: "The content of the message to send.",
                      },
                      phoneNumber: {
                        type: Type.STRING,
                        description: "Optional. The phone number to send the message to, including country code (e.g., +88017...). If unknown, leave empty.",
                      }
                    },
                    required: ["message"],
                  },
                },
                {
                  name: "stopSession",
                  description: "Stops the current voice session. Call this when the user says 'Stop Siri', 'Goodbye', 'থামো', or asks to end the conversation.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {},
                  },
                },
              ],
            },
          ],
        },
        callbacks: {
          onopen: () => {
            this.setState('listening');
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle audio output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              if (this.currentState !== 'speaking') {
                this.setState('speaking');
              }
              this.onAudioOutput(base64Audio);
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
              this.onInterrupted();
              this.setState('listening');
            }

            // Handle turn complete
            if (message.serverContent?.turnComplete) {
               this.setState('listening');
            }

            // Handle tool calls
            if (message.toolCall) {
              const functionCalls = message.toolCall.functionCalls;
              if (functionCalls && functionCalls.length > 0) {
                const responses = [];
                for (const call of functionCalls) {
                  if (call.name === 'openWebsite') {
                    const url = (call.args as any).url;
                    console.log("Opening website:", url);
                    // In a real app, we might use window.open, but in an iframe it might be blocked.
                    // We'll try to open it in a new tab.
                    window.open(url, '_blank');
                    responses.push({
                      id: call.id,
                      name: call.name,
                      response: { result: `Successfully opened ${url}` }
                    });
                  } else if (call.name === 'setTimer') {
                    const duration = (call.args as any).durationInSeconds;
                    const label = (call.args as any).label || 'Timer';
                    this.onSetTimer(duration, label);
                    responses.push({
                      id: call.id,
                      name: call.name,
                      response: { result: `Timer set for ${duration} seconds with label '${label}'` }
                    });
                  } else if (call.name === 'sendWhatsAppMessage') {
                    const message = (call.args as any).message;
                    const phoneNumber = (call.args as any).phoneNumber;
                    let waUrl = '';
                    if (phoneNumber) {
                      const cleanNumber = phoneNumber.replace(/[^\d+]/g, '');
                      waUrl = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(message)}`;
                    } else {
                      waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
                    }
                    console.log("Opening WhatsApp:", waUrl);
                    window.open(waUrl, '_blank');
                    responses.push({
                      id: call.id,
                      name: call.name,
                      response: { result: `WhatsApp opened with message: ${message}` }
                    });
                  } else if (call.name === 'stopSession') {
                    this.onStopSession();
                    responses.push({
                      id: call.id,
                      name: call.name,
                      response: { result: "Session stopped." }
                    });
                  }
                }
                if (this.session) {
                  this.session.sendToolResponse({ functionResponses: responses });
                }
              }
            }
          },
          onclose: () => {
            this.setState('idle');
            this.sessionPromise = null;
            this.session = null;
          },
          onerror: (error: any) => {
            let errMsg = "";
            if (error instanceof Error) {
              errMsg = error.message;
            } else if (error && typeof error === 'object' && error.message) {
              errMsg = String(error.message);
            } else {
              errMsg = String(error);
            }
            
            if (errMsg.toLowerCase().includes("aborted")) {
              console.log("Live API session ended or was aborted.");
            } else {
              console.error("Live API Error:", error);
            }
            this.setState('idle');
            this.sessionPromise = null;
            this.session = null;
          }
        },
      });

      this.session = await this.sessionPromise;
    } catch (error: any) {
      let errMsg = "";
      if (error instanceof Error) {
        errMsg = error.message;
      } else if (error && typeof error === 'object' && error.message) {
        errMsg = String(error.message);
      } else {
        errMsg = String(error);
      }
      
      if (errMsg.toLowerCase().includes("aborted")) {
        console.log("Live API connection aborted.");
      } else {
        console.error("Failed to connect to Live API:", error);
      }
      this.setState('idle');
      this.sessionPromise = null;
    }
  }

  public sendAudio(base64Data: string) {
    if (this.sessionPromise && this.currentState !== 'connecting') {
      this.sessionPromise.then((session) => {
        session.sendRealtimeInput({
          audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      });
    }
  }

  public sendVideo(base64Data: string) {
    if (this.sessionPromise && this.currentState !== 'connecting') {
      this.sessionPromise.then((session) => {
        session.sendRealtimeInput({
          video: { data: base64Data, mimeType: 'image/jpeg' }
        });
      });
    }
  }

  public getCurrentState(): SessionState {
    return this.currentState;
  }

  public disconnect() {
    if (this.session) {
      this.session.close();
      this.session = null;
      this.sessionPromise = null;
      this.setState('idle');
    }
  }
}
