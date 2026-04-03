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

// 定义允许的命令前缀，确保安全
const ALLOWED_COMMANDS = ["ansible", "ansible-playbook", "ansible-inventory", "ls"];

wss.on("connection", (ws) => {
  console.log("客户端已连接");

  ws.on("message", async (message) => {
    const commandString = message.toString().trim();
    if (!commandString) return;

    // 1. 将命令拆分为数组，防止 Shell 注入（如 ; rm -rf）
    const args = commandString.split(/\s+/);
    const baseCommand = args[0];

    // 2. 权限校验
    if (!ALLOWED_COMMANDS.includes(baseCommand)) {
      ws.send(`\r\n\x1b[31m❌ 禁止执行命令: ${baseCommand}\x1b[0m\r\n$ `);
      return;
    }

    try {
      ws.send(`\r\n\x1b[32m执行中: ${commandString}\x1b[0m\r\n`);

      // 3. 使用 Bun.spawn 启动进程
      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      });

      // 4. 实时读取 stdout 并发送给前端 xterm.js
      const streamOutput = async (reader) => {
        // const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // 直接发送原始字节流，xterm.js 会自动处理 ANSI 颜色
          ws.send(value);
        }
      };

      // 同时监听标准输出和错误输出
      await Promise.all([
        streamOutput(proc.stdout.getReader()),
        streamOutput(proc.stderr.getReader())
      ]);

      // 5. 进程结束后提示
      const exitCode = await proc.exited;
      ws.send(`\r\n\x1b[33m进程已结束，退出码: ${exitCode}\x1b[0m\r\n$ `);

    } catch (e) {
      ws.send(`\r\n\x1b[31m系统错误: ${e.message}\x1b[0m\r\n$ `);
    }
  });

  // 连接成功后发送一个初始提示符
  ws.send("\x1b[36m欢迎使用 Ansible Web 控制台\x1b[0m\r\n$ ");
});

const PORT = 3021;
server.listen(PORT, () => {
  console.log(`Bun 服务器运行在: http://localhost:${PORT}`);
});