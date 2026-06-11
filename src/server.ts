import { createApp } from "./app";
import { advanceAllProvisioningAutomation } from "./automation";
import { getConfig } from "./config";
import { RequestStore } from "./store";
import { createVerusId } from "./verus";

const config = getConfig();
const store = new RequestStore();
const app = createApp(config, store);
const host = config.uiHost || "127.0.0.1";

let automationTickRunning = false;
async function runAutomationTick(): Promise<void> {
  if (automationTickRunning) return;

  automationTickRunning = true;
  try {
    await advanceAllProvisioningAutomation({
      verusId: createVerusId(config),
      config,
      store,
    });
  } catch (error) {
    console.error("Provisioning automation tick failed:", error);
  } finally {
    automationTickRunning = false;
  }
}

app.listen(config.uiPort, host, () => {
  console.log(`Local VerusID provisioning webhook running at http://${host}:${config.uiPort}`);
  console.log(`Webhook base URL: ${config.webhookBaseUrl}`);
  console.log("Automatic VRSCTEST SubID registration is enabled.");
});

setInterval(runAutomationTick, 15000);
