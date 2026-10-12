import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.js"
import { Boundary } from "./components/Boundary.js"
import { bootRemote, isRemoteWindow } from "./remote/boot.js"
import "./styles/app.css"
import "./styles/items.css"
import "./styles/transcript-rail.css"
import "./styles/plan.css"
import "./styles/goal.css"
import "./styles/lane.css"
import "./styles/workbench.css"
import "./styles/workbench-activity.css"
import "./styles/workbench-files.css"
import "./styles/workbench-preview.css"
import "./styles/pets.css"
import "./styles/pets-dsh.css"
import "./styles/markdown.css"
import "./styles/status.css"
import "./styles/diff.css"
import "./styles/compare.css"
import "./styles/review.css"
import "./styles/review-interaction.css"
import "./styles/review-commit.css"
import "./styles/file-source.css"
import "./styles/popover.css"
import "./styles/panel-tabs.css"
import "./styles/settings.css"
import "./styles/settings-theme.css"
import "./styles/settings-engines.css"
import "./styles/settings-acp.css"
import "./styles/settings-dsh.css"
import "./styles/settings-activity.css"
import "./styles/settings-remote.css"
import "./styles/workspace-identity.css"
import "./styles/pane-handles.css"
import "./styles/notices.css"
import "./styles/interactions.css"
import "./styles/remote.css"

const root = document.getElementById("root")
if (root === null) throw new Error("找不到 #root 挂载点")

const app = (
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>
)

// 另一台电脑从宿主的 `/desk/` 打开的这一页：没有 preload，桥走 WebSocket（`remote/boot.tsx`）
if (isRemoteWindow()) void bootRemote(root, app)
else createRoot(root).render(app)
