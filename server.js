import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { router as authRouter } from "./auth.js";

const app = express();
app.use(express.json());
app.use("/api", authRouter);
app.use(express.static(path.join(import.meta.dir, "public")));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const ALLOWED_COMMANDS = ["ansible", "ansible-playbook", "ansible-inventory", "ls", "nu"];
const buffers = new Map();

wss.on("connection", (ws) => {
  buffers.set(ws, "");

  ws.on("message", async (message) => {
    const data = message.toString();
    let currentBuffer = buffers.get(ws);

    // --- 1. 处理回车：开始解析并执行 ---
    if (data === "\r" || data === "\n") {
      ws.send("\r\n");
      const fullCommand = currentBuffer.trim();
      buffers.set(ws, ""); // 执行前清空缓冲区

      if (!fullCommand) {
        ws.send("$ ");
        return;
      }

      // 拆分命令和参数，例如 "ls -la" -> ["ls", "-la"]
      const args = fullCommand.split(/\s+/).filter(arg => arg.length > 0);
      const cmd = args[0];

      // 【核心过滤逻辑】
      if (!ALLOWED_COMMANDS.includes(cmd)) {
        ws.send(`\x1b[31m❌ 权限拒绝: 禁止执行命令 '${cmd}'\x1b[0m\r\n$ `);
        return;
      }

      try {
        // 告知用户正在执行
        ws.send(`\x1b[32m[Exec]: ${fullCommand}\x1b[0m\r\n`);

        const proc = Bun.spawn(args, {
          stdout: "pipe",
          stderr: "pipe",
          env: process.env,
        });

        // 读取输出数据 (使用 Response 确保即使进程瞬间结束也能抓到数据)
        const [stdoutData, stderrData] = await Promise.all([
          new Response(proc.stdout).arrayBuffer(),
          new Response(proc.stderr).arrayBuffer()
        ]);

        const decoder = new TextDecoder();

        // 发送结果给前端
        if (stdoutData.byteLength > 0) {
          ws.send(decoder.decode(stdoutData));
        }
        if (stderrData.byteLength > 0) {
          ws.send(decoder.decode(stderrData));
        }

        const exitCode = await proc.exited;
        
        // 执行完后换行打印提示符
        ws.send(`\r\n$ `);

      } catch (e) {
        ws.send(`\r\n\x1b[31m执行失败: ${e.message}\x1b[0m\r\n$ `);
      }
      return;
    }

    // --- 2. 处理退格 (Backspace) ---
    if (data === "\x7f") {
      if (currentBuffer.length > 0) {
        currentBuffer = currentBuffer.slice(0, -1);
        buffers.set(ws, currentBuffer);
        ws.send("\b \b"); // 告诉 xterm.js 删掉最后一个字
      }
      return;
    }

    // --- 3. 普通输入：存入缓冲区并回显 ---
    currentBuffer += data;
    buffers.set(ws, currentBuffer);
    ws.send(data); 
  });


  ws.on("close", () => {
    buffers.delete(ws);
  });

  ws.send("\x1b[36m欢迎使用 Ansible Web 控制台\x1b[0m\r\n$ ");
});

const PORT = 3021;
server.listen(PORT, () => {
  console.log(`Bun 服务器运行在: http://localhost:${PORT}`);
});