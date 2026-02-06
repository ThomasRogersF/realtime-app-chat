import React, { useMemo, useState } from 'react';
import { ScenarioMenu } from './ScenarioMenu';
import { CallScreen } from './CallScreen';

export type Route =
  | { name: 'menu' }
  | { name: 'call'; scenarioId: string; userId: string; title: string };

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'menu' });

  const userId = useMemo(() => {
    // TODO: replace with real auth/user identity.
    return `user_${Math.random().toString(16).slice(2)}`;
  }, []);

  if (route.name === 'menu') {
    return (
      <ScenarioMenu
        userId={userId}
        onStart={(scenario) => setRoute({ name: 'call', scenarioId: scenario.id, userId, title: scenario.title })}
      />
    );
  }

  return (
    <CallScreen
      scenarioId={route.scenarioId}
      userId={route.userId}
      title={route.title}
      onExit={() => setRoute({ name: 'menu' })}
    />
  );
}
