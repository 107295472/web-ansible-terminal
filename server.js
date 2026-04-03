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
    ws.send("\r\n");
    const fullCommand = currentBuffer.trim();
    buffers.set(ws, "");

    if (!fullCommand) {
        ws.send("$ ");
        return;
    }

    // --- 关键点 1: 正确拆分参数 ---
    // 输入 "ls -l /" 会变成 ["ls", "-l", "/"]
    const args = fullCommand.split(/\s+/).filter(arg => arg.length > 0);
    const cmd = args[0];

    if (!ALLOWED_COMMANDS.includes(cmd)) {
        ws.send(`\x1b[31m❌ 禁止执行命令: ${cmd}\x1b[0m\r\n$ `);
        return;
    }

    try {
        // console.log(`[Debug] 正在执行数组:`, args);

        const proc = Bun.spawn(args, {
            stdout: "pipe",
            stderr: "pipe",
            env: process.env, // 确保环境变量传递
        });

        // --- 关键点 2: 使用更可靠的获取方式 ---
        // 直接等待输出完成
        const stdoutData = await new Response(proc.stdout).arrayBuffer();
        const stderrData = await new Response(proc.stderr).arrayBuffer();

        // 将结果转为 Uint8Array 发送给 xterm.js
        if (stdoutData.byteLength > 0) {
            ws.send(new Uint8Array(stdoutData));
        }
        
        if (stderrData.byteLength > 0) {
            ws.send(new Uint8Array(stderrData));
        }

        const exitCode = await proc.exited;
        
        // 如果 exitCode 是 0 但还是没输出，给个提示排查
        if (stdoutData.byteLength === 0 && stderrData.byteLength === 0) {
            ws.send(`\x1b[31m(命令已执行，但未捕获到任何输出内容)\x1b[0m\r\n`);
        }

        ws.send(`\r\n$ `);

    } catch (e) {
        console.error("执行出错:", e);
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