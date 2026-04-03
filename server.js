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
const ALLOWED_COMMANDS = ["ansible", "ansible-playbook", "ansible-inventory", "ls","nu"];

const buffers = new Map();

wss.on("connection", (ws) => {
  // console.log("客户端已连接");
  // 初始化当前连接的缓冲区
  buffers.set(ws, "");

  ws.on("message", async (message) => {
    const data = message.toString();
    let currentBuffer = buffers.get(ws);

   if (data === "\r" || data === "\n") {
    // 1. 先换行回显
    ws.send("\r\n");
    
    const fullCommand = currentBuffer.trim();
    buffers.set(ws, ""); // 立即清空，防止重复触发

    if (!fullCommand) {
        ws.send("$ ");
        return;
    }

    const args = fullCommand.split(/\s+/).filter(arg => arg.length > 0);
    
    try {
        const proc = Bun.spawn(args, {
            stdout: "pipe",
            stderr: "pipe",
            env: process.env
        });

        // 2. 获取输出（确保使用 await 等待读取完成）
        const [stdoutData, stderrData] = await Promise.all([
            new Response(proc.stdout).arrayBuffer(),
            new Response(proc.stderr).arrayBuffer()
        ]);

        const decoder = new TextDecoder();

        // 3. 发送输出内容
        if (stdoutData.byteLength > 0) {
            ws.send(decoder.decode(stdoutData));
        }
        if (stderrData.byteLength > 0) {
            ws.send(decoder.decode(stderrData));
        }

        // 4. 等待进程彻底退出
        await proc.exited;

        // 5. 【重要】在所有数据发送完毕后，额外加一个换行再给提示符
        // 这样可以确保提示符永远在新的一行开头
        ws.send("\r\n$ ");

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