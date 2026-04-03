import { Router } from "express";
import jwt from "jsonwebtoken";

const router = Router();

// 使用 Bun 内置的加密方式，或者保留原有的逻辑
const USER = {
  username: "admin",
  // Bun.password.hashSync 是 Bun 提供的更高效的加密方式
  passwordHash: await Bun.password.hash("a123456") 
};

const SECRET = "20251226flsdfjfj";

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (username !== USER.username) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  // 使用 Bun.password.verify 进行异步校验，性能更优
  const isMatch = await Bun.password.verify(password, USER.passwordHash);
  
  if (!isMatch) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  const token = jwt.sign({ username }, SECRET, { expiresIn: "12h" });

  res.json({ token });
});

export { router, SECRET };