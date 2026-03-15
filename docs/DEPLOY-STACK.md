# Pi Deploy Stack — 自动化部署依赖全景表

> 范围：从"原始 OS 已安装完成"到"用户开箱可用"的完整工具/组件清单。
> 用途：REQ-019 工具集设计、turn-key 服务包分层、安装链路 TC 覆盖范围参考。
> 维护：Daniel + CodeX 在 Phase 2 ready 阶段细化；REQ-019 实现时以本文为输入。

---

## 分层模型

| 层级 | 含义 | 商业定位 |
|------|------|----------|
| **L1 必装基线** | 不装就不能用 | 社区版自装，文档覆盖 |
| **L2 可选增值** | 按需开启，提升体验 | 社区版文档 + turn-key 代装 |
| **L3 闭源护城河** | 自动化交付能力本身 | turn-key 付费版核心卖点 |

---

## 完整依赖表（27 类）

| # | 类别 | 目标 | 具体工具 / 组件 | 层级 | 备注 |
|---|------|------|----------------|------|------|
| 1 | 设备身份初始化 | 设备有固定身份和管理用户 | `useradd` / `adduser`、`passwd`、`hostnamectl`、`groups`、`sudo` | L1 | 统一服务用户 `openclaw` |
| 2 | SSH 与远程入口 | 能远程接入并禁用高风险默认配置 | `openssh-server`、`authorized_keys`、`sshd_config` | L1 | 建议禁用密码登录 |
| 3 | 系统基础更新 | 保证系统包基线一致 | `apt update`、`apt upgrade`、`unattended-upgrades` | L1 | 出厂前锁一版基线快照 |
| 4 | 基础系统工具 | 让后续安装链路可执行 | `curl`、`wget`、`git`、`jq`、`ca-certificates`、`unzip`、`tar`、`vim`/`nano`、`htop`、`tree` | L1 | 最底层依赖 |
| 5 | 时间 / 区域配置 | 避免 token、日志、证书问题 | `timedatectl`、`chrony` 或 `systemd-timesyncd`、timezone、locale | L1 | 容易被忽略，但极关键 |
| 6 | 网络与代理诊断 | 确认联网和分流能力 | `ping`、`curl`、`dig` / `nslookup`、`ip`、`ss`、`traceroute` | L1 | REQ-019 诊断工具层输入 |
| 7 | 代理能力 | 解决 GitHub / Telegram / npm 访问 | `mihomo` / `clash-meta`、[auto-mihomo](https://github.com/rushwing/auto-mihomo) | L2 | 重要收费点，合规需注意 |
| 8 | 代理规则与订阅 | 可更新、可切换、可观测 | 订阅下发、配置模板、健康探测、延迟测速 | L2 | 卖"配置能力"，别只卖节点 |
| 9 | Tailscale 远程组网 | 用户随时访问家中 Pi | `tailscale`、auth key / claim flow、ACL / tag | L2 | 适合做一次性服务费 |
| 10 | GitHub 能力 | 拉代码、发版本、后续自动化 | `git`、`gh`、deploy key / PAT | L1 | 出厂预埋长期 PAT 风险高 |
| 11 | Node.js 运行时 | 给 open-workhorse / npm 生态打底 | `nvm` 或 Node 官方 tarball / apt 源 | L1 | 不要只依赖一种安装路径 |
| 12 | Python 运行时 | 给 openclaw 相关依赖打底 | `python3`、`pip`、`venv`、`pipx` | L1 | 版本策略要明确 |
| 13 | 构建工具链 | 编译原生模块或依赖 | `build-essential`、`gcc/g++`、`make`、`pkg-config`、`python-is-python3` | L1 | Pi 上经常缺这个 |
| 14 | openclaw 安装 | 主 Agent runtime 可运行 | openclaw binary / npm 包 / release 包 | L1 | 固定安装方式和版本策略 |
| 15 | openclaw 配置 | Lion 等 workspace 真正能启动 | `~/.openclaw/openclaw.json`、env、workspace 配置 | L1 | 高价值控制点；敏感值不落盘 |
| 16 | Telegram Bot 配置 | 主 Agent 对外沟通 | Bot token、chat / channel 绑定、Webhook / Polling 选型 | L1 | 做首启配对，不硬编码 |
| 17 | open-workhorse 安装 | 管理后台与网关可运行 | `git clone`、`npm install`、`npm run build` | L1 | 版本锁定 + 回滚策略 |
| 18 | open-workhorse 配置 | 管理页、token、监控正常 | `.env`、`LOCAL_API_TOKEN`、`OPENCLAW_HOME`、`MONITOR_CONTINUOUS` | L1 | 可做配置向导 |
| 19 | systemd 服务化 | 开机自启、异常拉起 | `systemctl --user`、`loginctl enable-linger`、service unit | L1 | appliance 感的关键 |
| 20 | 健康检查与验收 | 确认"真的可用" | `/healthz`、日志检查、Telegram 收发验证、agent roster 验证 | L1 | 收费交付证据 |
| 21 | 日志与故障排查 | 出问题能快速定位 | `journalctl`、应用日志、错误归类、诊断脚本 | L1 | REQ-019 错误翻译层的输入 |
| 22 | 升级前沙箱验证 | 避免升级炸机 | `docker compose` dry-run、测试容器、回滚包 | L3 | 企业版 / 订阅核心卖点 |
| 23 | 备份与恢复 | 防止配置损坏后不可用 | `tar`、配置备份、版本化快照、导出导入工具 | L2 | 配套 openclaw.json 可视化编辑 |
| 24 | 安全基线 | 降低被控风险 | 最小权限、SSH key、`ufw`、`fail2ban`、secret 不落盘或加密存储 | L2 | 商业化后必须补强 |
| 25 | 首启认领流程 | 把机器正式交给用户 | claim code、一次性 token、Web pairing wizard | L3 | 高建议；防止密钥硬编码出厂 |
| 26 | 增值服务编排 | 用户按套餐选装 | Tailscale、Telegram、多 Bot、代理、监控、升级托管 | L3 | 套餐化基础 |
| 27 | 运营与售后支撑 | 交付后还能服务 | 远程诊断、工单、版本矩阵、FAQ、升级通知 | L3 | 决定复购和口碑 |

---

## 产品视角 7 大类（收口版）

1. **设备初始化**（#1–5）
2. **网络与远程接入**（#6–10）
3. **基础运行时与开发工具链**（#11–13）
4. **openclaw 安装与配置**（#14–16）
5. **open-workhorse 安装与配置**（#17–19）
6. **服务化、监控与验收**（#20–21）
7. **增值服务与升级托管**（#22–27）

---

## 收费边界草稿

| 版本 | 包含 | 不包含 |
|------|------|--------|
| **社区版（自装）** | L1 全部 + 文档 | L2 / L3 |
| **turn-key 代装** | L1 + L2（代理、Tailscale、Telegram 配对） | L3 自动化能力本身 |
| **turn-key 订阅** | L1 + L2 + L3（Agentic Deploy、升级沙箱、远程运维控制台） | — |

> **关键边界**：`Tailscale`、`Telegram`、API key、代理配置等强账号属性的东西，
> 做成"首次配对 / 认领式配置"，不在出厂时长期硬编码到机器里。
> 可以卖"自动配置能力"和"代装服务"，但用户密钥通过首启向导或一次性 claim token 绑定。

---

## 关联文档

- `docs/SETUP.md` — Pi 手动部署步骤手册
- `tasks/features/REQ-019.md` — Agentic Deploy 工具集需求（L3 护城河核心）
- `tasks/phases/PHASE-002.md` — P2 Appliance Ready 阶段目标与 exit criteria
