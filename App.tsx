import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Mic, MicOff, Loader2, Camera, CameraOff } from 'lucide-react';
import { AudioManager } from './lib/audioManager';
import { LiveSessionManager, SessionState } from './lib/liveSession';

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [timer, setTimer] = useState<{ duration: number, remaining: number, label: string } | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  const audioManagerRef = useRef<AudioManager | null>(null);
  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const sessionStateRef = useRef<SessionState>('idle');
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    audioManagerRef.current = new AudioManager();
    
    liveSessionRef.current = new LiveSessionManager(
      (state) => setSessionState(state),
      (base64Audio) => {
        audioManagerRef.current?.playAudio(base64Audio);
      },
      () => {
        audioManagerRef.current?.stopPlayback();
      },
      (duration, label) => {
        setTimer({ duration, remaining: duration, label });
      },
      () => {
        stopSessionHandler();
      }
    );

    audioManagerRef.current.setOnAudioData((base64Data) => {
      liveSessionRef.current?.sendAudio(base64Data);
    });

    return () => {
      audioManagerRef.current?.stopRecording();
      audioManagerRef.current?.stopPlayback();
      liveSessionRef.current?.disconnect();
    };
  }, []);

  const startSession = async () => {
    try {
      await audioManagerRef.current?.startRecording();
      await liveSessionRef.current?.connect();
    } catch (err) {
      console.error("Failed to start session:", err);
      setSessionState('idle');
    }
  };

  const stopSessionHandler = () => {
    audioManagerRef.current?.stopRecording();
    audioManagerRef.current?.stopPlayback();
    liveSessionRef.current?.disconnect();
  };

  // Wake Word Setup
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech Recognition API not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'bn-BD';

    recognition.onresult = (event: any) => {
      const current = event.resultIndex;
      const transcript = event.results[current][0].transcript.toLowerCase();
      
      if (
        transcript.includes('hey siri') || 
        transcript.includes('হে সিরি') || 
        transcript.includes('he siri') || 
        transcript.includes('এই সিরি') ||
        transcript.includes('হ্যালো সিরি') ||
        transcript.includes('hello siri')
      ) {
        recognition.stop();
        if (sessionStateRef.current === 'idle') {
          startSession();
        }
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech') {
        console.warn("Wake word recognition error:", event.error);
      }
    };

    recognition.onend = () => {
      if (sessionStateRef.current === 'idle') {
        try { recognition.start(); } catch (e) {}
      }
    };

    recognitionRef.current = recognition;

    if (sessionStateRef.current === 'idle') {
      try { recognition.start(); } catch (e) {}
    }

    return () => {
      recognition.stop();
    };
  }, []);

  // Manage recognition lifecycle based on session state
  useEffect(() => {
    if (!recognitionRef.current) return;
    if (sessionState === 'idle') {
      try { recognitionRef.current.start(); } catch (e) {}
    } else {
      try { recognitionRef.current.stop(); } catch (e) {}
    }
  }, [sessionState]);

  // Timer countdown logic
  useEffect(() => {
    if (!timer || timer.remaining <= 0) return;
    
    const interval = setInterval(() => {
      setTimer(prev => {
        if (!prev) return null;
        if (prev.remaining <= 1) {
          clearInterval(interval);
          return { ...prev, remaining: 0 };
        }
        return { ...prev, remaining: prev.remaining - 1 };
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [timer?.duration, timer?.label]);

  // Camera stream setup
  useEffect(() => {
    let stream: MediaStream | null = null;
    if (cameraEnabled) {
      setCameraError(null);
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640 } })
        .then(s => {
          stream = s;
          if (videoRef.current) videoRef.current.srcObject = s;
        })
        .catch(e => {
          console.warn("Camera permission denied or unavailable:", e);
          setCameraEnabled(false);
          setCameraError("Camera permission denied. Please allow camera access in your browser settings.");
        });
    } else {
      if (videoRef.current && videoRef.current.srcObject) {
        const s = videoRef.current.srcObject as MediaStream;
        s.getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = null;
      }
    }
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [cameraEnabled]);

  // Frame extraction loop
  useEffect(() => {
    if (sessionState === 'idle' || sessionState === 'connecting' || !cameraEnabled) {
       if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
       return;
    }
    
    videoIntervalRef.current = setInterval(() => {
      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.videoWidth === 0) return;

      // Scale down for performance
      const targetWidth = 640;
      const scale = targetWidth / video.videoWidth;
      canvas.width = targetWidth;
      canvas.height = video.videoHeight * scale;
      
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
      const base64 = dataUrl.split(',')[1];
      
      liveSessionRef.current?.sendVideo(base64);
    }, 1000); // 1 FPS is usually enough for Gemini Live

    return () => {
      if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
    };
  }, [sessionState, cameraEnabled]);

  const toggleSession = async () => {
    if (sessionState === 'idle') {
      await startSession();
    } else {
      stopSessionHandler();
    }
  };

  const getStatusText = () => {
    switch (sessionState) {
      case 'idle': return 'Tap to wake me up';
      case 'connecting': return 'Connecting...';
      case 'listening': return 'I\'m listening...';
      case 'speaking': return 'Speaking...';
      default: return '';
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center relative overflow-hidden font-sans text-white">
      {/* Futuristic Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(220,38,38,0.15)_0%,rgba(0,0,0,1)_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.8)_100%)]" />
      </div>

      {/* Camera Preview */}
      {cameraEnabled && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute bottom-8 left-8 w-32 h-48 rounded-2xl overflow-hidden border border-red-500/30 shadow-[0_0_20px_rgba(220,38,38,0.15)] z-20"
        >
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        </motion.div>
      )}
      <canvas ref={canvasRef} className="hidden" />

      {/* Camera Toggle Button */}
      <button 
        onClick={() => setCameraEnabled(!cameraEnabled)}
        className={`absolute bottom-8 right-8 p-4 rounded-full border transition-all z-20 ${
          cameraEnabled 
            ? 'bg-red-600/20 border-red-500 text-red-400 shadow-[0_0_15px_rgba(220,38,38,0.3)]' 
            : 'bg-neutral-900 border-neutral-800 text-neutral-500 hover:text-neutral-300'
        }`}
        title={cameraEnabled ? "Disable Camera" : "Enable Camera"}
      >
        {cameraEnabled ? <Camera className="w-6 h-6" /> : <CameraOff className="w-6 h-6" />}
      </button>

      {/* Camera Error Toast */}
      {cameraError && (
        <motion.div 
          initial={{ opacity: 0, y: 20, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          className="absolute bottom-24 left-1/2 bg-red-900/90 text-white px-4 py-3 rounded-lg text-sm z-50 text-center w-max max-w-[90vw] shadow-lg border border-red-500/50"
        >
          {cameraError}
          <button onClick={() => setCameraError(null)} className="ml-3 text-red-300 hover:text-white underline font-medium">Dismiss</button>
        </motion.div>
      )}

      {/* Timer Overlay */}
      {timer && (
        <motion.div 
          initial={{ opacity: 0, y: -20, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          className="absolute top-12 left-1/2 bg-neutral-900/80 backdrop-blur-md border border-red-500/30 px-6 py-4 rounded-3xl flex flex-col items-center min-w-[160px] shadow-[0_0_30px_rgba(220,38,38,0.15)] z-50"
        >
          <span className="text-red-400/80 text-xs uppercase tracking-widest mb-1 font-medium">{timer.label}</span>
          <span className={`text-4xl font-mono tracking-wider ${timer.remaining === 0 ? 'text-red-500 animate-pulse drop-shadow-[0_0_10px_rgba(220,38,38,0.8)]' : 'text-white'}`}>
            {Math.floor(timer.remaining / 60).toString().padStart(2, '0')}:{(timer.remaining % 60).toString().padStart(2, '0')}
          </span>
          {timer.remaining === 0 && (
            <button 
              onClick={() => setTimer(null)} 
              className="mt-3 px-4 py-1.5 bg-red-500/20 hover:bg-red-500/40 text-red-300 rounded-full text-xs uppercase tracking-wider transition-colors"
            >
              Dismiss
            </button>
          )}
        </motion.div>
      )}

      {/* Main Content */}
      <div className="z-10 flex flex-col items-center justify-center w-full max-w-md px-6">
        
        {/* Title */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-16 text-center"
        >
          <h1 className="text-4xl font-light tracking-widest text-red-500 uppercase mb-2">Siri</h1>
          <p className="text-red-400/60 text-sm tracking-wider uppercase">AI Assistant</p>
        </motion.div>

        {/* Central Orb / Button */}
        <div className="relative flex items-center justify-center w-64 h-64 mb-12">
          
          {/* Outer Glow Rings based on state */}
          {sessionState !== 'idle' && (
            <>
              <motion.div
                className="absolute inset-0 rounded-full border border-red-500/30"
                animate={{
                  scale: sessionState === 'speaking' ? [1, 1.5, 1] : sessionState === 'listening' ? [1, 1.2, 1] : 1,
                  opacity: sessionState === 'speaking' ? [0.3, 0, 0.3] : sessionState === 'listening' ? [0.5, 0, 0.5] : 0.5,
                }}
                transition={{
                  duration: sessionState === 'speaking' ? 1 : 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              />
              <motion.div
                className="absolute inset-4 rounded-full border border-red-500/40"
                animate={{
                  scale: sessionState === 'speaking' ? [1, 1.3, 1] : sessionState === 'listening' ? [1, 1.1, 1] : 1,
                  opacity: sessionState === 'speaking' ? [0.4, 0, 0.4] : sessionState === 'listening' ? [0.6, 0, 0.6] : 0.6,
                }}
                transition={{
                  duration: sessionState === 'speaking' ? 1.2 : 2.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 0.2
                }}
              />
            </>
          )}

          {/* Core Button */}
          <motion.button
            onClick={toggleSession}
            className={`relative z-10 flex items-center justify-center w-32 h-32 rounded-full shadow-2xl transition-all duration-500 ${
              sessionState === 'idle' 
                ? 'bg-neutral-900 border border-red-900/50 hover:border-red-500/50 hover:shadow-[0_0_30px_rgba(220,38,38,0.3)]' 
                : 'bg-red-600 border border-red-400 shadow-[0_0_50px_rgba(220,38,38,0.6)]'
            }`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {sessionState === 'idle' ? (
              <Mic className="w-10 h-10 text-red-500/80" />
            ) : sessionState === 'connecting' ? (
              <Loader2 className="w-10 h-10 text-white animate-spin" />
            ) : sessionState === 'listening' ? (
              <div className="flex gap-1 items-center justify-center h-10">
                {[1, 2, 3].map((i) => (
                  <motion.div
                    key={i}
                    className="w-2 bg-white rounded-full"
                    animate={{ height: ["20%", "80%", "20%"] }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      delay: i * 0.2,
                      ease: "easeInOut"
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex gap-1.5 items-center justify-center h-12">
                {[1, 2, 3, 4, 5].map((i) => (
                  <motion.div
                    key={i}
                    className="w-2 bg-white rounded-full"
                    animate={{ height: ["20%", "100%", "20%"] }}
                    transition={{
                      duration: 0.5 + Math.random() * 0.5,
                      repeat: Infinity,
                      delay: i * 0.1,
                      ease: "easeInOut"
                    }}
                  />
                ))}
              </div>
            )}
          </motion.button>
        </div>

        {/* Status Text */}
        <motion.div 
          className="h-8 text-center"
          animate={{ opacity: sessionState === 'idle' ? 0.5 : 1 }}
        >
          <p className={`text-lg font-medium tracking-wide ${sessionState === 'idle' ? 'text-neutral-500' : 'text-red-400'}`}>
            {getStatusText()}
          </p>
        </motion.div>

        {/* Instructions/Hint */}
        {sessionState === 'idle' && (
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-12 text-xs text-neutral-600 text-center max-w-xs"
          >
            Say <span className="text-red-400/80 font-medium">"Hey Siri"</span> or tap the mic to wake me up.
          </motion.p>
        )}
      </div>
    </div>
  );
}
