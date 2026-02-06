import React, { useMemo, useState } from 'react';
import { useRealtime } from '../useRealtime/useRealtime';

export type TranscriptItem = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
};

export function CallScreen(props: {
  scenarioId: string;
  userId: string;
  title: string;
  onExit: () => void;
}) {
  const [started, setStarted] = useState(false);

  const { connected, events, transcript } = useRealtime({
    enabled: started,
    scenarioId: props.scenarioId,
    userId: props.userId
  });

  const status = useMemo(() => {
    if (!started) return 'Idle';
    return connected ? 'Connected' : 'Connecting…';
  }, [started, connected]);

  return (
    <div className="container">
      <div className="header">
        <button className="bigButton" style={{ width: 90, padding: 10 }} onClick={props.onExit}>
          Exit
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700 }}>{props.title}</div>
          <div className="small">{status}</div>
        </div>
        <div className="small">Progress: TODO</div>
      </div>

      <div className="transcript">
        {transcript.length === 0 ? (
          <div className="small">Transcript will appear here.</div>
        ) : (
          transcript.map((m) => (
            <div key={m.id} className={`bubble ${m.role}`}>
              {m.text}
            </div>
          ))
        )}

        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Debug: last events</div>
          <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {events.map((e) => JSON.stringify(e, null, 2)).join('\n\n')}
          </pre>
        </div>
      </div>

      <div className="footer">
        <button className="bigButton" disabled={started} onClick={() => setStarted(true)}>
          Start Call
        </button>
      </div>
    </div>
  );
}
