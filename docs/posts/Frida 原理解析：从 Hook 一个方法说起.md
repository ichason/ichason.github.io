# Frida 原理深度解析：从 Hook 一个方法说起

## 目录

- [什么是 Frida](#什么是-frida)
- [核心概念：动态插桩](#核心概念动态插桩)
- [从 Hook 一个方法开始](#从-hook-一个方法开始)
- [Frida 注入流程详解](#frida-注入流程详解)
- [底层实现原理](#底层实现原理)
- [实战案例](#实战案例)

---

## 什么是 Frida

Frida 是一个动态代码插桩工具，可以在**运行时**修改应用程序的行为，无需重新编译或修改原始代码。

**生动比喻：**
想象你在看一场话剧，演员正在台上表演。Frida 就像一个隐形导演，可以在演出过程中：

- 偷听演员的台词（监控函数调用）
- 修改演员的台词（修改函数参数/返回值）
- 让演员加戏（注入新代码）
- 甚至换掉某个演员（替换整个函数）

关键是：**观众（应用本身）完全不知道剧本被改了**。

---

## 核心概念：动态插桩

### 什么是插桩（Instrumentation）？

插桩就是在程序的关键位置"插入"监控代码，就像在高速公路上安装测速摄像头。

**静态插桩 vs 动态插桩：**

| 类型   | 时机      | 比喻          |
| ---- | ------- | ----------- |
| 静态插桩 | 编译前修改源码 | 在建房子时就装好监控  |
| 动态插桩 | 运行时注入代码 | 房子建好后，偷偷装监控 |

Frida 属于**动态插桩**，优势是：

- 不需要源码
- 不需要重新编译
- 可以随时开启/关闭

---

## 从 Hook 一个方法开始

### 场景：Hook Android 的 `String.equals()` 方法

假设我们要监控某个 App 的密码验证逻辑，目标是 Hook `String.equals()` 方法。

#### 1. 最简单的 Frida 脚本

```javascript
// hook_equals.js
Java.perform(function() {
    var String = Java.use("java.lang.String");

    String.equals.implementation = function(other) {
        console.log("[*] equals() 被调用了！");
        console.log("    this = " + this);
        console.log("    参数 = " + other);

        // 调用原始方法
        var result = this.equals(other);
        console.log("    返回值 = " + result);

        return result;
    };
});
```

#### 2. 运行脚本

```bash
frida -U -f com.example.app -l hook_equals.js
```

#### 3. 输出示例

```
[*] equals() 被调用了！
    this = admin
    参数 = user_input_password
    返回值 = false
```

---

## Frida 注入流程详解

现在我们深入理解：**Frida 是如何把上面的 JavaScript 代码注入到 Android App 里的？**

### 整体架构

```
你的电脑（Host）                    手机/模拟器（Target）
┌─────────────────┐                ┌──────────────────────┐
│  Frida CLI      │                │   目标 App 进程       │
│  (Python/JS)    │                │                      │
│                 │   ① 连接        │                      │
│  hook_equals.js │───────────────>│   Frida Agent        │
└─────────────────┘                │   (注入的 JS 引擎)    │
                                   │         ↓            │
                                   │   ② Hook 目标方法    │
                                   │         ↓            │
                                   │   java.lang.String   │
                                   └──────────────────────┘
```

### 详细步骤拆解

#### 步骤 0：准备工作

在手机上运行 `frida-server`：

```bash
adb push frida-server /data/local/tmp/
adb shell "chmod 755 /data/local/tmp/frida-server"
adb shell "/data/local/tmp/frida-server &"
```

**原理：** `frida-server` 是一个守护进程，负责接收电脑的指令，并执行注入操作。

---

#### 步骤 1：进程附加（Attach）

当你执行 `frida -U -f com.example.app -l hook_equals.js` 时，完整的流程是：

##### 1.1 Frida CLI 解析命令参数

```bash
frida -U -f com.example.app -l hook_equals.js
```

参数含义：

- `-U`：使用 USB 连接的设备
- `-f`：spawn 模式（启动新进程并立即附加）
- `com.example.app`：目标应用的包名
- `-l`：加载 JavaScript 脚本文件

##### 1.2 连接 frida-server

Frida CLI 通过 ADB 端口转发（默认 27042）连接到手机上的 `frida-server`：

```
你的电脑                          手机
┌─────────┐                    ┌──────────────┐
│ Frida   │  TCP 27042         │ frida-server │
│ CLI     │ ─────────────────> │ (监听中)      │
└─────────┘                    └──────────────┘
```

##### 1.3 frida-server 查找目标进程

收到指令后，`frida-server` 会根据不同模式执行不同操作：

**情况 A：spawn 模式（使用 `-f` 参数）**

```c
// frida-server 的伪代码
1. 调用 Android 的 am (Activity Manager) 启动应用
   system("am start -n com.example.app/.MainActivity");

2. 启动时会返回新进程的 PID
   pid_t target_pid = get_pid_from_am();

3. 在进程启动的瞬间就附加上去（在 App 初始化之前）
   ptrace(PTRACE_ATTACH, target_pid, ...);
```

**优势：** 可以 Hook 应用启动时的代码，比如 Application.onCreate()

**情况 B：attach 模式（使用 `-n` 参数附加到已运行的进程）**

```c
// frida-server 的伪代码
1. 遍历 /proc 目录，查找包名对应的进程
   for (pid in /proc/*) {
       cmdline = read("/proc/{pid}/cmdline");
       if (cmdline == "com.example.app") {
           target_pid = pid;
           break;
       }
   }

2. 附加到找到的进程
   ptrace(PTRACE_ATTACH, target_pid, ...);
```

##### 1.4 包名到 PID 的转换原理

在 Android 上，每个应用进程的包名存储在 `/proc/[pid]/cmdline` 文件中：

```bash
# 查看所有运行的应用进程
ps -A | grep com.example.app

# 输出示例
u0_a123  12345  456  com.example.app
```

`frida-server` 的实际查找逻辑（简化版）：

```c
DIR* proc_dir = opendir("/proc");
struct dirent* entry;

while ((entry = readdir(proc_dir)) != NULL) {
    // 跳过非数字目录
    if (!is_numeric(entry->d_name)) continue;

    // 读取 cmdline 文件
    char cmdline_path[256];
    sprintf(cmdline_path, "/proc/%s/cmdline", entry->d_name);

    FILE* f = fopen(cmdline_path, "r");
    char package_name[256];
    fgets(package_name, sizeof(package_name), f);
    fclose(f);

    // 匹配包名
    if (strcmp(package_name, "com.example.app") == 0) {
        target_pid = atoi(entry->d_name);
        break;
    }
}
```

##### 1.5 完整时序图

```
Frida CLI                frida-server              Android 系统
    |                         |                          |
    |  ① 发送指令              |                          |
    |  {spawn, pkg, script}   |                          |
    |------------------------>|                          |
    |                         |                          |
    |                         |  ② 启动应用               |
    |                         |  am start -n pkg         |
    |                         |------------------------->|
    |                         |                          |
    |                         |  ③ 返回 PID=12345        |
    |                         |<-------------------------|
    |                         |                          |
    |                         |  ④ 附加进程               |
    |                         |  ptrace(ATTACH, 12345)   |
    |                         |------------------------->|
    |                         |                          |
    |  ⑤ 确认附加成功          |                          |
    |<------------------------|                          |
```

##### 1.6 ptrace 系统调用详解

附加成功后，使用 `ptrace` 系统调用控制目标进程：

```c
// Linux 系统调用
ptrace(PTRACE_ATTACH, target_pid, NULL, NULL);
```

**什么是 ptrace？**

`ptrace`（process trace）是 Linux/Unix 系统提供的**进程跟踪调试接口**，最初是为 GDB 调试器设计的。它允许一个进程（tracer）完全控制另一个进程（tracee）。

**重要理解：ptrace 的真实角色**

ptrace 只是一个**"开门工具"**，它的作用是：

- ✅ 获得控制目标进程的权限
- ✅ 为真正的注入创造条件
- ✅ 写入 shellcode 并让进程执行

但 ptrace **本身不负责**：

- ❌ 加载动态库（.so）
- ❌ 执行 Hook 代码
- ❌ 修改函数逻辑

**生动比喻：**

- **ptrace = 开锁工具**：就像小偷用铁丝开锁进入房间，只负责"打开门"
- **dlopen = 搬运工**：真正把 frida-agent.so 搬进进程内存的是 dlopen
- ptrace 只是帮 dlopen 获得了"进门的权限"

---

**ptrace 的核心能力**

| 能力          | 说明                                                                        | 实际用途                        |
| ----------- | ------------------------------------------------------------------------- | --------------------------- |
| **暂停/恢复进程** | `PTRACE_ATTACH` 附加后，目标进程会被暂停；`PTRACE_CONT` 恢复执行；`PTRACE_DETACH` 断开连接并恢复执行 | 让 Frida 有时间注入代码，注入完成后恢复正常运行 |
| **读取内存**    | `PTRACE_PEEKDATA` 读取任意内存地址                                                | 查找函数地址、读取变量值                |
| **写入内存**    | `PTRACE_POKEDATA` 写入任意内存地址                                                | 注入 shellcode、修改指令           |
| **读取寄存器**   | `PTRACE_GETREGS` 获取 CPU 寄存器状态                                             | 查看当前执行位置（PC）、参数（r0-r3）      |
| **修改寄存器**   | `PTRACE_SETREGS` 修改 CPU 寄存器                                               | 改变执行流程，跳转到注入的代码             |
| **单步执行**    | `PTRACE_SINGLESTEP` 执行一条指令后暂停                                             | 调试时逐条分析代码                   |

---

**Frida 如何使用 ptrace 注入代码**

完整流程示例：

```c
// 1. 附加到目标进程
ptrace(PTRACE_ATTACH, target_pid, NULL, NULL);
waitpid(target_pid, NULL, 0);  // 等待进程暂停

// 2. 保存原始寄存器状态
struct user_regs_struct old_regs;
ptrace(PTRACE_GETREGS, target_pid, NULL, &old_regs);

// 3. 在目标进程的内存中写入 shellcode
// 这段 shellcode 会调用 dlopen() 加载 frida-agent.so
unsigned char shellcode[] = {
    0x01, 0x00, 0x9f, 0xe5,  // LDR r0, [pc, #4]  ; 加载字符串地址
    0x00, 0x10, 0xa0, 0xe3,  // MOV r1, #0        ; RTLD_NOW
    0x00, 0x00, 0x00, 0xef,  // SVC #0            ; 系统调用 dlopen
    // ... 后面是 "/data/local/tmp/frida-agent.so" 字符串
};

// 写入 shellcode 到目标进程的内存
for (int i = 0; i < sizeof(shellcode); i += 4) {
    ptrace(PTRACE_POKEDATA, target_pid,
           remote_addr + i,
           *(long*)(shellcode + i));
}

// 4. 修改 PC 寄存器，让进程执行我们的 shellcode
struct user_regs_struct new_regs = old_regs;
new_regs.ARM_pc = remote_addr;  // 跳转到 shellcode
ptrace(PTRACE_SETREGS, target_pid, NULL, &new_regs);

// 5. 恢复进程执行
ptrace(PTRACE_CONT, target_pid, NULL, NULL);

// 6. 等待 dlopen 执行完成
waitpid(target_pid, NULL, 0);

// 7. 恢复原始寄存器，让进程继续正常运行
ptrace(PTRACE_SETREGS, target_pid, NULL, &old_regs);
ptrace(PTRACE_DETACH, target_pid, NULL, NULL);
```

---

**关键步骤图解**

```
目标进程正常运行
    ↓
① ptrace(ATTACH) ──> 进程被暂停 ⏸️
    ↓
② 读取寄存器/内存 ──> 保存现场
    ↓
③ 写入 shellcode ──> 注入 dlopen 调用
    ↓
④ 修改 PC 寄存器 ──> 跳转到 shellcode
    ↓
⑤ ptrace(CONT) ──> 执行 shellcode
    ↓
⑥ dlopen 加载 frida-agent.so ✅
    ↓
⑦ 恢复寄存器 ──> 回到原来的执行位置
    ↓
⑧ ptrace(DETACH) ──> 进程继续运行（但已被注入）
```

---

**为什么 ptrace 这么强大？**

因为它直接操作**进程的内核数据结构**：

```
用户空间                内核空间
┌─────────────┐        ┌──────────────────┐
│ frida-server│        │  task_struct     │
│             │        │  (进程控制块)     │
│ ptrace()    │───────>│  - 内存映射表     │
└─────────────┘        │  - 寄存器状态     │
                       │  - 执行状态       │
                       └──────────────────┘
```

内核会检查权限，如果允许，就直接修改目标进程的数据结构，所以可以做到：

- 读写任意内存（绕过进程隔离）
- 修改执行流程（改变 PC 寄存器）
- 注入代码（写入 shellcode）

---

**权限要求**

ptrace 需要满足以下条件之一：

1. **Root 权限**：可以附加任何进程
2. **同一用户**：只能附加自己启动的进程
3. **可调试标志**：目标应用设置了 `android:debuggable="true"`
4. **SELinux 允许**：Android 的安全策略允许 ptrace

这就是为什么 Frida 通常需要 root 权限的原因。

---

**ptrace 的局限性**

1. **性能开销**：每次操作都需要系统调用，频繁使用会很慢
2. **单一 tracer**：一个进程只能被一个 tracer 附加（GDB 和 Frida 不能同时用）
3. **反调试检测**：应用可以检测自己是否被 ptrace 附加

```c
// 应用的反调试代码
if (ptrace(PTRACE_TRACEME, 0, NULL, NULL) == -1) {
    printf("检测到调试器！退出...\n");
    exit(1);
}
```

Frida 需要绕过这些检测。

---

#### 步骤 2：注入 Frida Agent

附加成功后，`frida-server` 需要在目标进程里加载 **Frida Agent**（一个动态库）。

**Android 注入方法：**

1. 在目标进程的内存中分配空间
2. 写入 `dlopen()` 的调用代码
3. 修改指令指针（PC 寄存器），让进程执行 `dlopen()`
4. `dlopen()` 加载 `frida-agent.so`

**伪代码：**

```c
// 在目标进程中执行
void* handle = dlopen("/data/local/tmp/frida-agent.so", RTLD_NOW);
```

**生动比喻：**
警察坐进车里后，偷偷在后备箱放了一个监控设备（frida-agent.so），这个设备会持续运行。

---

#### 步骤 3：启动 JavaScript 引擎并建立通信通道

`frida-agent.so` 内置了一个 **V8 JavaScript 引擎**（和 Chrome 浏览器用的一样）。

**关键问题：** dlopen 加载 frida-agent.so 后，它是如何自动启动并接收 JS 代码的？

##### 3.1 动态库的构造函数机制

在 Linux/Android 中，动态库可以定义**构造函数**，这些函数会在 `dlopen()` 加载库时**自动执行**。

```c
// frida-agent.so 的入口代码（简化版）
__attribute__((constructor))
void frida_agent_init() {
    // 这个函数在 dlopen() 时自动调用
    printf("[Frida] Agent 已加载到进程 %d\n", getpid());

    // 1. 初始化 V8 引擎
    init_v8_engine();

    // 2. 注册 Frida API
    register_frida_apis();

    // 3. 建立与 frida-server 的通信通道
    connect_to_frida_server();

    // 4. 启动消息循环，等待接收 JS 代码
    start_message_loop();
}
```

**`__attribute__((constructor))` 的作用：**

- 这是 GCC 的扩展语法
- 标记的函数会在 `dlopen()` 返回**之前**自动执行
- 类似于 C++ 的全局对象构造函数

**执行时机：**

```
dlopen("/data/local/tmp/frida-agent.so")
  ↓
加载 .so 到内存
  ↓
解析符号表
  ↓
执行构造函数 frida_agent_init()  ← 自动执行！
  ↓
dlopen() 返回
```

---

##### 3.2 建立通信通道

frida-agent.so 启动后，需要与 frida-server 建立**双向通信**，用于：

- 接收 JS 脚本
- 发送 console.log 输出
- 传递 Hook 结果

**通信方式：Unix Domain Socket**

```c
// frida-agent.so 的通信代码
void connect_to_frida_server() {
    // 1. 创建 Unix Socket
    int sock = socket(AF_UNIX, SOCK_STREAM, 0);

    // 2. 连接到 frida-server 预留的 socket 文件
    struct sockaddr_un addr;
    addr.sun_family = AF_UNIX;
    sprintf(addr.sun_path, "/data/local/tmp/frida-%d.sock", getpid());

    connect(sock, (struct sockaddr*)&addr, sizeof(addr));

    // 3. 发送握手消息
    send(sock, "FRIDA_AGENT_READY", 17, 0);

    // 4. 保存 socket，用于后续通信
    g_frida_socket = sock;
}
```

**通信架构：**

```
你的电脑                    手机
┌─────────────┐          ┌──────────────────────────┐
│ Frida CLI   │          │  frida-server            │
│             │  TCP     │  (监听 27042)            │
│             │◄────────►│         ↕                │
└─────────────┘          │  Unix Socket             │
                         │         ↕                │
                         │  目标进程                 │
                         │  ┌────────────────────┐  │
                         │  │ frida-agent.so     │  │
                         │  │ (注入的 JS 引擎)    │  │
                         │  └────────────────────┘  │
                         └──────────────────────────┘
```

**为什么用 Unix Socket？**

- 同一台机器上的进程间通信（IPC）
- 比 TCP 更快，延迟更低
- 不需要网络权限

---

##### 3.3 初始化 V8 引擎

```c
void init_v8_engine() {
    // 1. 初始化 V8 平台
    v8::V8::InitializePlatform(platform);
    v8::V8::Initialize();

    // 2. 创建 Isolate（V8 的独立实例）
    v8::Isolate::CreateParams create_params;
    create_params.array_buffer_allocator =
        v8::ArrayBuffer::Allocator::NewDefaultAllocator();
    isolate = v8::Isolate::New(create_params);

    // 3. 创建执行上下文
    v8::Isolate::Scope isolate_scope(isolate);
    v8::HandleScope handle_scope(isolate);
    v8::Local<v8::Context> context = v8::Context::New(isolate);
    v8::Context::Scope context_scope(context);

    // 4. 注册 Frida 的全局对象
    register_frida_globals(context);
}
```

---

##### 3.4 注册 Frida API

Frida 需要把 C++ 函数暴露给 JavaScript，使用 **V8 的绑定机制**：

```c
void register_frida_apis() {
    v8::Local<v8::ObjectTemplate> global = v8::ObjectTemplate::New(isolate);

    // 注册 Java 对象
    v8::Local<v8::ObjectTemplate> java_obj = v8::ObjectTemplate::New(isolate);
    java_obj->Set(
        v8::String::NewFromUtf8(isolate, "perform"),
        v8::FunctionTemplate::New(isolate, Java_perform)  // C++ 函数
    );
    java_obj->Set(
        v8::String::NewFromUtf8(isolate, "use"),
        v8::FunctionTemplate::New(isolate, Java_use)
    );
    global->Set(v8::String::NewFromUtf8(isolate, "Java"), java_obj);

    // 注册 Interceptor 对象
    v8::Local<v8::ObjectTemplate> interceptor_obj = v8::ObjectTemplate::New(isolate);
    interceptor_obj->Set(
        v8::String::NewFromUtf8(isolate, "attach"),
        v8::FunctionTemplate::New(isolate, Interceptor_attach)
    );
    global->Set(v8::String::NewFromUtf8(isolate, "Interceptor"), interceptor_obj);

    // 注册 console 对象
    v8::Local<v8::ObjectTemplate> console_obj = v8::ObjectTemplate::New(isolate);
    console_obj->Set(
        v8::String::NewFromUtf8(isolate, "log"),
        v8::FunctionTemplate::New(isolate, Console_log)
    );
    global->Set(v8::String::NewFromUtf8(isolate, "console"), console_obj);
}
```

**这样，JavaScript 就可以调用这些 API：**

```javascript
Java.perform(...)      // 调用 C++ 的 Java_perform 函数
Interceptor.attach(...) // 调用 C++ 的 Interceptor_attach 函数
console.log(...)       // 调用 C++ 的 Console_log 函数
```

---

##### 3.5 启动消息循环

frida-agent.so 需要持续监听来自 frida-server 的消息：

```c
void start_message_loop() {
    // 创建新线程，避免阻塞主线程
    pthread_t thread;
    pthread_create(&thread, NULL, message_loop_thread, NULL);
}

void* message_loop_thread(void* arg) {
    while (true) {
        // 1. 从 socket 读取消息
        char buffer[4096];
        int len = recv(g_frida_socket, buffer, sizeof(buffer), 0);

        if (len <= 0) break;

        // 2. 解析消息类型
        Message* msg = parse_message(buffer, len);

        switch (msg->type) {
            case MSG_LOAD_SCRIPT:
                // 执行 JS 脚本
                execute_javascript(msg->script_code);
                break;

            case MSG_POST_MESSAGE:
                // 处理来自 JS 的消息
                handle_js_message(msg->data);
                break;

            case MSG_DETACH:
                // 卸载 Agent
                cleanup_and_exit();
                break;
        }
    }
    return NULL;
}
```

**关键点：** 现在目标进程里有两套代码在运行：

- 原始的 Java/Native 代码（App 本身）
- Frida 的 JavaScript 引擎（注入的，在独立线程中）

---

#### 步骤 4：接收并执行你的 Hook 脚本

当你在电脑上运行 `frida -U -f com.example.app -l hook_equals.js` 时：

##### 4.1 Frida CLI 读取脚本文件

```python
# Frida CLI 的 Python 代码（简化版）
script_code = open("hook_equals.js", "r").read()

# 发送到 frida-server
session.create_script(script_code)
```

##### 4.2 frida-server 转发脚本

```
Frida CLI                frida-server              frida-agent.so
    |                         |                          |
    |  ① 发送脚本内容          |                          |
    |  {type: "load_script",  |                          |
    |   code: "Java.perform..."} |                       |
    |------------------------>|                          |
    |                         |                          |
    |                         |  ② 通过 Unix Socket 转发  |
    |                         |  MSG_LOAD_SCRIPT         |
    |                         |------------------------->|
    |                         |                          |
    |                         |                          |  ③ 执行 JS
    |                         |                          |  V8 引擎运行
    |                         |                          |
    |                         |  ④ 返回执行结果          |
    |                         |<-------------------------|
    |                         |                          |
    |  ⑤ 脚本加载成功          |                          |
    |<------------------------|                          |
```

##### 4.3 V8 引擎执行 JavaScript

```c
void execute_javascript(const char* script_code) {
    v8::Isolate::Scope isolate_scope(isolate);
    v8::HandleScope handle_scope(isolate);
    v8::Context::Scope context_scope(context);

    // 1. 编译 JS 代码
    v8::Local<v8::String> source =
        v8::String::NewFromUtf8(isolate, script_code);
    v8::Local<v8::Script> script =
        v8::Script::Compile(context, source).ToLocalChecked();

    // 2. 执行 JS 代码
    v8::Local<v8::Value> result = script->Run(context).ToLocalChecked();

    // 3. 发送执行结果回 frida-server
    send_message_to_server("script_loaded", "success");
}
```

**执行你的脚本：**

```javascript
Java.perform(function() {
    var String = Java.use("java.lang.String");
    String.equals.implementation = function(other) {
        // 你的 Hook 代码
    };
});
```

---

#### 步骤 5：Hook 代码的实际执行

**这段代码做了什么？**

##### 5.1 `Java.perform()`

等待 Java 虚拟机（ART/Dalvik）初始化完成，然后执行回调。

**原理：** 通过 JNI 接口检查 `JavaVM` 是否可用。

---

##### 5.2 `Java.use("java.lang.String")`

通过 JNI 找到 `java.lang.String` 类的定义。

**底层调用：**

```c
jclass clazz = (*env)->FindClass(env, "java/lang/String");
```

**返回：** 一个 JavaScript 对象，包装了 Java 类的所有方法。

---

##### 5.3 修改 `equals.implementation`

这是 Frida 的核心魔法！

**原理：** 修改方法的入口地址，让它跳转到你的 Hook 函数。

**详细过程：**

1. **找到原始方法的地址**
   
   ```c
   jmethodID method = (*env)->GetMethodID(env, clazz, "equals", "(Ljava/lang/Object;)Z");
   void* original_addr = get_method_address(method);
   ```

2. **分配新的内存页**
   
   ```c
   void* trampoline = mmap(NULL, 4096, PROT_READ|PROT_WRITE|PROT_EXEC, ...);
   ```

3. **写入跳转指令**
   
   ```assembly
   ; 在原始方法入口写入
   JMP trampoline  ; 跳转到 Frida 的处理函数
   ```

4. **Frida 的处理函数**
   
   ```c
   void frida_handler() {
       // 1. 执行你的 JavaScript Hook 代码
       call_js_function("your_hook_function");
   
       // 2. 如果需要，调用原始方法
       call_original_method();
   }
   ```

**生动比喻：**
原本的函数是一条直路，Frida 在路口放了一个路标，把车（执行流）引到你的检查站（Hook 函数），检查完再放行到原来的路。

---

## 底层实现原理

### 1. 内存布局

注入后，目标进程的内存变成这样：

```
┌─────────────────────────────────┐
│  App 原始代码段                  │  <-- .text 段
│  - Java 字节码                   │
│  - Native 代码 (.so)             │
├─────────────────────────────────┤
│  Frida Agent (.so)               │  <-- 注入的
│  - V8 引擎                       │
│  - Hook 引擎                     │
│  - 你的 JS 脚本                  │
├─────────────────────────────────┤
│  Trampoline 代码                 │  <-- 跳转桥梁
│  (保存原始指令 + 跳转)           │
└─────────────────────────────────┘
```

### 2. Hook 的三种实现方式

#### 方式 A：Inline Hook（内联钩子）

直接修改目标函数的机器码：

```assembly
; 原始函数
String.equals:
    PUSH {r4-r7, lr}
    MOV r4, r0
    ...

; Hook 后
String.equals:
    LDR pc, [pc, #0]    ; 加载跳转地址到 PC
    .word 0x12345678    ; Frida handler 地址
    ; 原始指令被保存到 trampoline
```

**优点：** 性能好，直接跳转
**缺点：** 需要处理指令对齐、相对跳转等复杂问题

---

#### 方式 B：GOT/PLT Hook

修改全局偏移表（Global Offset Table）：

```
调用链：
App 调用 libc.so 的 open()
  ↓
查 GOT 表获取 open() 地址
  ↓
Frida 修改 GOT 表，指向自己的函数
  ↓
执行 Frida 的 Hook 代码
```

**优点：** 不修改代码段，更安全
**缺点：** 只能 Hook 动态链接的函数

---

#### 方式 C：ART Hook（Android 特有）

利用 ART 虚拟机的内部结构：

```c
// ART 的方法结构
struct ArtMethod {
    void* entry_point_;  // 方法入口
    void* code_;         // 实际代码
    ...
};

// Frida 修改
art_method->entry_point_ = frida_handler;
```

**优点：** 专门针对 Java 方法，稳定性好
**缺点：** 依赖 ART 版本

---

### 3. 调用原始方法的原理

当你在 Hook 里调用 `this.equals(other)` 时，Frida 怎么知道要调用原始方法？

**答案：** Frida 在 Hook 之前，把原始指令保存到了 **Trampoline**（跳板）。

```
┌──────────────────┐
│ 原始方法入口      │ ──> JMP frida_handler
└──────────────────┘
         │
         │ Frida 保存了原始指令
         ↓
┌──────────────────┐
│ Trampoline       │
│ PUSH {r4-r7, lr} │ <-- 原始的前几条指令
│ MOV r4, r0       │
│ JMP 原始方法+8   │ <-- 跳回原始方法继续执行
└──────────────────┘
```

**调用流程：**

```
你的 Hook 函数
  ↓
this.equals(other)
  ↓
Frida 调用 trampoline
  ↓
执行原始指令
  ↓
返回结果
```

---

## 实战案例

### 案例 1：绕过 SSL 证书校验

```javascript
Java.perform(function() {
    // Hook OkHttp3 的证书验证
    var CertificatePinner = Java.use("okhttp3.CertificatePinner");

    CertificatePinner.check.overload('java.lang.String', 'java.util.List')
        .implementation = function(hostname, peerCertificates) {
            console.log("[*] 绕过证书校验: " + hostname);
            // 直接返回，不抛出异常
            return;
        };
});
```

**原理：** `check()` 方法本来会验证证书，抛出异常。我们把它替换成空函数，直接返回。



---

### 案例 2：Hook Native 函数

```javascript
Interceptor.attach(Module.findExportByName("libnative.so", "check_license"), {
    onEnter: function(args) {
        console.log("[*] check_license 被调用");
        console.log("    参数1: " + args[0]);
    },
    onLeave: function(retval) {
        console.log("    原始返回值: " + retval);
        retval.replace(1);  // 修改返回值为 1（通过验证）
    }
});
```

**原理：** `Interceptor.attach()` 在函数入口和出口插入回调。

---

## 总结

### Frida 的核心流程

```
1. 附加进程 (ptrace)
   ↓
2. 注入 Agent (dlopen)
   ↓
3. 启动 JS 引擎 (V8)
   ↓
4. 执行 Hook 脚本
   ↓
5. 修改方法入口 (Inline Hook / ART Hook)
   ↓
6. 拦截调用，执行你的代码
   ↓
7. 可选：调用原始方法 (Trampoline)
```

### 关键技术点

| 技术          | 作用         | 比喻     |
| ----------- | ---------- | ------ |
| ptrace      | 附加进程       | 警察拦车   |
| dlopen      | 加载动态库      | 安装监控设备 |
| Inline Hook | 修改指令       | 改路标    |
| Trampoline  | 保存原始代码     | 备份原路线图 |
| JNI         | 操作 Java 对象 | 翻译器    |

### 为什么 Frida 这么强大？

1. **动态性：** 运行时修改，无需重启
2. **灵活性：** JavaScript 脚本，易于编写
3. **跨平台：** 支持 Android、iOS、Windows、Linux
4. **无侵入：** 不修改 APK，不需要 root（部分场景）

---

## 延伸阅读

- Frida 官方文档：https://frida.re/docs/
- ART 虚拟机源码：https://android.googlesource.com/platform/art/
- Inline Hook 原理：搜索 "ARM Inline Hook"
- ptrace 系统调用：`man ptrace`

---

**最后的比喻：**

Frida 就像《黑客帝国》里的 Neo，可以在程序运行时"看到"并"修改"代码的 Matrix。而你写的 Hook 脚本，就是 Neo 的超能力。
