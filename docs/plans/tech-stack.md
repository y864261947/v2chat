# 技术栈决策说明（D18 详述）

> 记录技术栈的完整推导过程，供团队成员理解"为什么是这套"。结论已录入总计划 D18。

## 三层结构

1. **客户端栈**（无选择权）：fork Chatbox 即继承 React 18 + TS + Capacitor 7 + SQLite。替换等于放弃二开价值。Capacitor 的取舍：一套代码三端跑 vs 极限性能不如原生——对聊天类 App 成立。
2. **后端栈**（唯一自由选择）：见下。
3. **AI 供应链**（商务采购）：推理=任意 OpenAI 兼容中转（网关屏蔽，可随时换）；语音克隆倾向 fish-audio 备选 MiniMax（B2 前定）；云记忆 Honcho 托管版。决策权在 Alex。

## 后端选型方法：约束筛选

| # | 约束 | 筛掉 |
|---|---|---|
| ① | 核心=SSE 流式透传网关（长连接） | Serverless（冷启动杀长连接） |
| ② | 客户端 TS，协议类型两边共享 | Go / Python / Java（双份类型定义） |
| ③ | 一人运维，单容器部署 | 微服务、K8s、多组件架构 |
| ④ | 代码主要由 AI 编写，需生态主流 | 小众新锐框架 |
| ⑤ | 起步几十~几百用户，零运维优先 | 起手 Postgres/Redis 集群 |

## 结论与落选对比

| 位置 | 选择 | 落选者与原因 |
|---|---|---|
| 运行时 | Node 22 + TypeScript | Bun/Deno（生态坑、AI 语料少）；Go（违反②） |
| 框架 | Hono | Express（老、类型弱）；Fastify（可用但 Hono 更轻且 Web 标准 API）；NestJS（违反③） |
| 数据库 | SQLite（WAL） | Postgres（长大后再迁，违反⑤） |
| ORM | Drizzle | Prisma（重、代码生成链长）；Drizzle 使 SQLite→Postgres 仅改配置 |
| 校验 | zod | 客户端同款，schema 可共享（②的落地） |
| 部署 | Docker 单容器 + VPS | Serverless（违反①）；国内 VPS 即可 |

## 演进出口（让改变便宜）

- 用户增长：SQLite → Postgres（Drizzle 改方言+连接串）；单容器 → 多实例（token 鉴权无状态，仅需共享库）
- 供应商更换：上游模型/语音供应商都在网关之后，客户端与协议无感
- 原则：**约束驱动选型 + 每个选择留演进出口**。新的技术决策沿用此方法并追加到本文档。
