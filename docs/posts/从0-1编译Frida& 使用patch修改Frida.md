# 从 0 到 1 编译 Frida

## 前置依赖

> 开始编译前，必须先安装好以下依赖

### Android NDK

> **注意：NDK 版本必须是 r25，其他版本可能导致编译失败。**

在 `~` 目录下执行以下命令下载 NDK：

```bash
cd ~
wget -c https://dl.google.com/android/repository/android-ndk-r25-linux.zip
```

下载完成后解压：

```bash
unzip android-ndk-r25-linux.zip
```

解压完成后，配置环境变量：

```bash
vim ~/.bashrc
```

在文件最后添加以下两行：

```bash
export ANDROID_NDK_ROOT=~/value/android-ndk-r25c
export PATH=$PATH:$ANDROID_NDK_ROOT
```

保存退出后，使环境变量生效：

```bash
source ~/.bashrc
```

> `ANDROID_NDK_ROOT` 是 frida 编译时必须识别的环境变量，`PATH` 则让系统能找到 NDK 的可执行文件。

### Node.js

> **注意：Node.js 版本至少需要 18.x，推荐通过 nvm 管理版本。**

**第一步：安装 nvm**

在任意目录下执行：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
```

**可能的报错：**
```
curl: (7) Failed to connect to 192.168.31.1 port 7890 after 0 ms: Connection refused
```
原因：代理配置了但服务未运行，临时绕过代理：
```bash
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
```

安装完成后让 nvm 在当前终端生效：
```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

**第二步：安装 Node.js 20.10.0**

先查看可安装的 Node 版本（可选）：

```bash
nvm ls-remote
```

安装并使用 20.10.0：

```bash
nvm install 20.10.0
nvm use 20.10.0
node --version  # 验证，应输出 v20.10.0
```

---

## 环境说明

| 项目 | 版本 |
|------|------|
| 虚拟机软件 | VMware 17.6.1 build-24319023 |
| 主机系统 | Windows 11 Home 64-bit (Build 26200.7840) |
| 虚拟机系统 | Ubuntu 22.04 LTS 64位 |
| Ubuntu 下载 | https://mirrors.aliyun.com/ubuntu-releases/22.04.4 |

---

## 一、准备环境

### 1.1 安装基础工具

在配置环境前，先安装必要的系统工具：

```bash
sudo apt update
sudo apt install build-essential git vim curl
```

> `build-essential` 包含 gcc、g++、make 等编译工具，是后续编译 frida 的基础。

### 1.2 配置 VMware 共享文件夹

**第一步：开启共享文件夹**

点击顶部菜单 `虚拟机(M)` → `设置` → 在弹出窗口顶部找到 `选项` 标签 → `共享文件夹` → 启用

**第二步：在 Ubuntu 中挂载共享文件夹**

```bash
sudo mkdir -p /mnt/hgfs
sudo /usr/bin/vmhgfs-fuse .host:/ /mnt/hgfs -o allow_other -o uid=0 -o gid=0 -o umask=022
```

> **命令解析：**
> - `vmhgfs-fuse` — VMware 提供的 FUSE 文件系统驱动，用于挂载宿主机共享目录
> - `.host:/` — 表示宿主机的所有共享文件夹
> - `/mnt/hgfs` — 挂载到虚拟机的目标目录
> - `-o allow_other` — 允许非 root 用户访问
> - `-o uid=0 -o gid=0 -o umask=022` — 设置文件权限

**可能的报错：**
```
bad mount point '/mnt/hgfs': No such file or directory
```
原因：挂载目标目录不存在，需要先创建：
```bash
sudo mkdir -p /mnt/hgfs
```
然后重新执行挂载命令即可。

**第三步：设置开机自动挂载**

```bash
sudo chmod 777 /etc/fstab
echo '.host:/ /mnt/hgfs fuse.vmhgfs-fuse allow_other,uid=0,gid=0,umask=022 0 0' | sudo tee -a /etc/fstab
```

验证写入成功：
```bash
tail -5 /etc/fstab
```

**第四步：在桌面创建共享文件夹快捷方式（软链接）**

```bash
ln -s /mnt/hgfs/gx ~/Desktop/
```

> **注意：** 解压文件时不要解压到 `/mnt/hgfs` 共享文件夹，VMware 共享文件夹对某些文件操作支持不完整，可能报错。建议解压到本地目录如 `~/` 或 `~/Desktop/`。

---

### 1.2 安装 nvm（Node 版本管理器）

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.4/install.sh | bash
```

**可能的报错：**
```
curl: (7) Failed to connect to 192.168.31.1 port 7890 after 0 ms: Connection refused
```
原因：系统配置了代理环境变量，但代理服务未运行。临时绕过代理：
```bash
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.4/install.sh | bash
```

**安装成功的输出：**
```
=> nvm is already installed in /home/chason/.nvm, trying to update using git
=> nvm source string already in /home/chason/.bashrc
=> Close and reopen your terminal to start using nvm or run the following to use it now:
```

**让 nvm 在当前终端生效（无需重开终端）：**
```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
```

验证：
```bash
nvm --version
```

> **说明：** 上面的 export 命令只需在安装后第一次手动执行，之后重开终端会自动生效（已写入 `~/.bashrc`）。

---

## 二、Frida 架构说明

在编译前，先理解 Frida 各组件的关系：

```
frida（用户层：Python/JS 绑定、命令行工具）
└── frida-core（核心层：进程注入、设备通信、Agent 管理）
    └── frida-gum（底层引擎：函数拦截、代码追踪、内存操作）
```

| 组件 | 职责 |
|------|------|
| frida-gum | 最底层，实现 Interceptor、Stalker 等插桩能力 |
| frida-core | 中间层，基于 gum 实现 frida-server、frida-agent，处理注入逻辑 |
| frida | 最上层，面向用户的工具集（frida-ps、frida-trace 等） |

> frida-gum 是 frida-core 的 git submodule（子模块）。

---

## 三、编译 Frida

### 3.1 克隆源码

```bash
git clone https://github.com/frida/frida-core.git
```

**可能的报错：**
```
fatal: unable to access 'https://github.com/frida/frida-core.git/':
gnutls_handshake() failed: The TLS connection was non-properly terminated.
```
原因：git 没有走代理。配置 git 代理（根据实际代理地址修改）：
```bash
git config --global http.proxy http://192.168.31.1:7890
git config --global https.proxy http://192.168.31.1:7890
```
然后重新 clone。

### 3.2 初始化子模块

```bash
cd frida-core
git submodule update --init --recursive
```

> **说明：** 如果命令执行后没有任何输出，属于正常现象，表示子模块已经全部初始化完成，或本身没有需要更新的子模块。可用 `git submodule status` 查看状态。



### 3.3 配置编译目标

```bash
./configure --host=android-arm64
```

> **命令解析：**
> - `./configure` — 运行配置脚本，检查依赖、生成 Makefile
> - `--host=android-arm64` — 指定目标平台为 Android ARM64（交叉编译）
>
> 这种方式叫**交叉编译**：在 x86 Linux 上编译，生成能在 Android 64位设备上运行的二进制文件。

### 3.4 编译

```bash
make
```

`make` 完成且无报错，即编译成功。编译产物位于 `build/server` 目录下。

---


## 四、使用补丁修改 Frida 源码

> 补丁本质是别人对源码的修改记录（`.patch` 文件），应用后可以让 Frida 具备额外能力，比如过检测、改特征等。这里以 [Florida](https://github.com/Ylarod/Florida) 项目为例。

**第一步：在与 frida-core 同级目录下克隆 Florida**

```bash
git clone https://github.com/Ylarod/Florida.git
```

目录结构应如下：
```
~/value/
├── frida-core/
└── Florida/
```

**第二步：在 frida-core 目录下创建 patch 目录**

```bash
mkdir frida-core/patch
```

**第三步：将 Florida 的补丁复制到 frida-core/patch 目录**

```bash
cp -r Florida/patches/frida-core frida-core/patch/
```

> 将 `Florida/patches/frida-core/` 目录下所有补丁文件复制到 `frida-core/patch/frida-core/` 中。

**第四步：进入 frida-core 目录，应用补丁**

```bash
cd frida-core
git am patch/frida-core/*.patch
```

> **命令解析：**
> - `git am` — 应用补丁并同时生成 commit 记录（区别于 `git apply` 不产生 commit）
> - `patch/frida-core/*.patch` — 通配符，批量应用该目录下所有 `.patch` 文件

**第五步：重新编译**

```bash
make
```

编译完成后得到的即是已应用补丁、经过修改的 Frida。







## 五、常见问题汇总

| 问题 | 原因 | 解决方法 |
|------|------|----------|
| `curl: (7) Failed to connect to 代理IP` | 代理配置了但服务未运行 | `unset http_proxy https_proxy` 后重试 |
| `gnutls_handshake() failed` | git 未走代理无法访问 GitHub | `git config --global http.proxy http://代理IP:端口` |
| `No such file or directory: /mnt/hgfs` | 挂载目录不存在 | `sudo mkdir -p /mnt/hgfs` 后重新挂载 |
| 解压提示空间不足 | 解压目标在共享文件夹或只读设备 | 解压到本地目录如 `~/Desktop/` |
| `nvm: command not found` | nvm 未在当前终端加载 | 执行 `export NVM_DIR=...` 或重开终端 |
| `git submodule update` 无输出 | 正常现象，子模块已是最新 | 用 `git submodule status` 确认状态 |
| `make` 报错提示缺少某文件，但文件实际存在 | 文件没有可执行权限 | `chmod +x <文件名>` 赋予可执行权限后重试 |
| `no C compiler found` 或 `no C++ compiler found` | 系统缺少编译工具链 | 执行下方命令安装 |

```bash
sudo apt update
sudo apt install build-essential g++ gcc make cmake
```
