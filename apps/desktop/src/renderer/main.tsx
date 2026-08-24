import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.js"
import { Boundary } from "./components/Boundary.js"
import "./styles/app.css"
import "./styles/items.css"
import "./styles/plan.css"
import "./styles/lane.css"
import "./styles/pets.css"
import "./styles/pets-dsh.css"
import "./styles/markdown.css"
import "./styles/status.css"
import "./styles/diff.css"
import "./styles/compare.css"
import "./styles/review.css"
import "./styles/popover.css"
import "./styles/settings.css"
import "./styles/settings-engines.css"
import "./styles/settings-dsh.css"

const root = document.getElementById("root")
if (root === null) throw new Error("找不到 #root 挂载点")

createRoot(root).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
)
