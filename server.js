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

const buffers = new Map();

wss.on("connection", (ws) => {
  console.log("客户端已连接");
  // 初始化当前连接的缓冲区
  buffers.set(ws, "");

  ws.on("message", async (message) => {
    const data = message.toString();
    let currentBuffer = buffers.get(ws);

    // 1. 处理回车键 (CR: \r)
    if (data === "\r" || data === "\n") {
      ws.send("\r\n"); // 换行
      const fullCommand = currentBuffer.trim();
      buffers.set(ws, ""); // 清空缓冲区以备下次输入

      if (fullCommand.length === 0) {
        ws.send("$ ");
        return;
      }

      // 解析命令和参数
      const args = fullCommand.split(/\s+/);
      const cmd = args[0];
      // console.log(cmd)
      // 2. 权限校验
      if (!ALLOWED_COMMANDS.includes(cmd)) {
        ws.send(`\x1b[31m❌ 禁止执行命令: ${cmd}\x1b[0m\r\n$ `);
        return;
      }

      try {
        ws.send(`\x1b[32m执行中: ${fullCommand}\x1b[0m\r\n`);

        const proc = Bun.spawn(args, { // 此时 args 是完整的数组
          stdout: "pipe",
          stderr: "pipe",
        });

        const streamOutput = async (reader) => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            ws.send(value);
          }
        };

        await Promise.all([
          streamOutput(proc.stdout.getReader()),
          streamOutput(proc.stderr.getReader())
        ]);

        const exitCode = await proc.exited;
        ws.send(`\r\n\x1b[33m进程已结束，退出码: ${exitCode}\x1b[0m\r\n$ `);
      } catch (e) {
        ws.send(`\r\n\x1b[31m系统错误: ${e.message}\x1b[0m\r\n$ `);
      }
      return;
    }

    // 2. 处理退格键 (Backspace: \x7f)
    if (data === "\x7f") {
      if (currentBuffer.length > 0) {
        currentBuffer = currentBuffer.slice(0, -1);
        buffers.set(ws, currentBuffer);
        // 向前端发送控制序列：退一格、删一格、再退一格，实现视觉上的删除
        ws.send("\b \b");
      }
      return;
    }

    // 3. 普通字符：存入缓冲区并回显给前端
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