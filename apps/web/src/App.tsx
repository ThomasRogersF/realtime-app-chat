import { Routes, Route } from "react-router-dom";
import { MenuPage } from "./pages/MenuPage";
import { CallPage } from "./pages/CallPage";
import { ResultsPage } from "./pages/ResultsPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<MenuPage />} />
      <Route path="/call/:scenarioId" element={<CallPage />} />
      <Route path="/results/:sessionKey" element={<ResultsPage />} />
    </Routes>
  );
}
