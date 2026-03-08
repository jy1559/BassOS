import { useEffect, useState } from "react";

export function useChallengeCountdown(running: boolean, seconds: number) {
  const [remainingSec, setRemainingSec] = useState(seconds);

  useEffect(() => {
    if (!running) return;
    setRemainingSec(seconds);
  }, [running, seconds]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemainingSec((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return {
    remainingSec,
    setRemainingSec,
  };
}
