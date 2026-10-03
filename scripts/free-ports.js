// Stops stale Heirloom dev servers (an old `next dev` on 3000, an old Hardhat node on 8545) so `npm run dev` can start cleanly.
// It only touches processes that clearly belong to this project; anything else is reported and left alone.
const { listeners, commandLine, isOurs, kill } = require("./ports");

const PORTS = [3000, 3001, 8545];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let blocked = false;
  for (const port of PORTS) {
    for (const pid of listeners(port)) {
      let cmd = commandLine(pid);
      // A process that is shutting down (for example because its parent was just stopped) has no command line any more.
      if (!cmd) {
        await sleep(1500);
        if (!listeners(port).includes(pid)) continue; // gone by itself
        cmd = commandLine(pid);
      }
      if (cmd && isOurs(cmd)) {
        kill(pid);
        console.log(`Stopped PID ${pid} on port ${port}: ${cmd.slice(0, 110)}`);
      } else {
        blocked = true;
        console.error(`Port ${port} is used by PID ${pid}, which does not look like a Heirloom dev server, so it was left alone:
  ${(cmd || "(could not read its command line)").slice(0, 160)}`);
      }
    }
  }
  if (blocked) process.exit(1);
  await sleep(500);
  const still = PORTS.filter((p) => listeners(p).length);
  if (still.length) {
    console.error(`Ports still busy after stopping: ${still.join(", ")}. Try again in a moment.`);
    process.exit(1);
  }
  console.log("Dev ports are free.");
})();
