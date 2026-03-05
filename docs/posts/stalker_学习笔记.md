# Frida Stalker 基本使用

## 概述

Stalker 是 Frida 的代码追踪引擎，基于动态二进制插桩（DBI）技术，能够在运行时追踪线程执行的每一条指令、每一次函数调用和返回。它通过 **JIT 重编译** 目标代码，在执行前将用户插入的回调逻辑织入其中。

---

## 一、Stalker.follow() — 启动追踪

### 基本用法

```javascript
Stalker.follow(threadId, {
  transform(iterator) {
    // 在这里对指令流进行插桩
  }
});
```

### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| `threadId` | number | 要追踪的线程 ID，通过 `Process.getCurrentThreadId()` 或枚举线程获取 |
| `options.transform` | function | 每当 Stalker 编译一个新的基本块时调用，用于插入自定义逻辑 |

### 获取线程 ID 的常见方式

```javascript
// 追踪当前线程
const tid = Process.getCurrentThreadId();
Stalker.follow(tid, { transform(iterator) { /* ... */ } });

// 追踪目标函数所在线程（配合 Interceptor 使用）
Interceptor.attach(targetAddr, {
  onEnter() {
    Stalker.follow(Process.getCurrentThreadId(), {
      transform(iterator) { /* ... */ }
    });
  },
  onLeave() {
    Stalker.unfollow(Process.getCurrentThreadId());
  }
});
```

### transform 回调的触发时机

- Stalker 以 **基本块（Basic Block）** 为单位编译代码
- 每遇到一个 **未编译过的基本块**，就调用一次 `transform`
- 在 `transform` 中，通过 `iterator` 遍历该基本块内的所有指令

### 完整示例

```javascript
const tid = Process.getCurrentThreadId();

Stalker.follow(tid, {
  transform(iterator) {
    let instruction;
    while ((instruction = iterator.next()) !== null) {
      // 在每条 call 指令前插入回调
      if (instruction.mnemonic === 'call') {
        iterator.putCallout((context) => {
          console.log(`call -> ${context.pc}`);
        });
      }
      iterator.keep();
    }
  }
});
```

---

## 二、iterator.next() / iterator.keep() — 遍历和保留指令

### iterator.next()

```javascript
const instruction = iterator.next();
```

- **作用**：从当前基本块中取出下一条指令
- **返回值**：`Instruction` 对象，或当基本块遍历完毕时返回 `null`
- **必须在循环中调用**，直到返回 `null` 才算遍历完一个基本块

`Instruction` 对象的常用属性：

| 属性 | 类型 | 说明 |
|------|------|------|
| `address` | NativePointer | 指令地址 |
| `mnemonic` | string | 助记符，如 `mov`、`call`、`ret` |
| `opStr` | string | 操作数字符串，如 `rax, rbx` |
| `size` | number | 指令字节数 |

```javascript
while ((instruction = iterator.next()) !== null) {
  console.log(`[${instruction.address}] ${instruction.mnemonic} ${instruction.opStr}`);
  iterator.keep();
}
```

### iterator.keep()

```javascript
iterator.keep();
```

- **作用**：将当前指令 **原样保留** 到重编译后的代码流中
- **如果不调用 keep()**，该指令将被 **丢弃**（不会执行）
- **通常每条指令都需要调用**，除非你有意替换或删除某条指令

### 两者的配合模式

```
iterator.next()  -->  获取指令（读取）
iterator.keep()  -->  保留指令（写入重编译流）
```

**标准遍历模式（保留所有指令）：**

```javascript
transform(iterator) {
  let ins;
  while ((ins = iterator.next()) !== null) {
    // 在指令前插入操作
    if (ins.mnemonic === 'ret') {
      iterator.putCallout((ctx) => {
        console.log('函数即将返回，pc =', ctx.pc.toString());
      });
    }
    iterator.keep(); // 保留原始指令
  }
}
```

**跳过某条指令（不调用 keep）：**

```javascript
transform(iterator) {
  let ins;
  while ((ins = iterator.next()) !== null) {
    if (ins.mnemonic === 'nop') {
      // 不调用 keep()，该 nop 指令被丢弃
      continue;
    }
    iterator.keep();
  }
}
```

### iterator.putCallout()

在 `keep()` 之前或之后插入一段 JavaScript 回调，在目标代码执行到此处时触发：

```javascript
iterator.putCallout((context) => {
  // context 是 CpuContext，可读取寄存器
  console.log('rax =', context.rax.toString(16));
});
```

---

## 三、Stalker.unfollow() / flush() / garbageCollect() — 干净地停止

停止 Stalker 追踪需要按照顺序调用三个 API，每一步都有其作用。

### 3.1 Stalker.unfollow(threadId)

```javascript
Stalker.unfollow(threadId);
```

- **作用**：告知 Stalker **不再跟随** 指定线程
- **注意**：此时 Stalker 只是标记停止，**已编译的代码块尚未释放**
- 被追踪线程可能仍在执行 Stalker 的重编译代码，所以不能立即回收内存

### 3.2 Stalker.flush()

```javascript
Stalker.flush();
```

- **作用**：将 Stalker **内部缓冲的事件数据** 强制刷新（flush）到回调
- 适用于使用 `events` 选项（如 `call`、`ret`、`exec`）时，确保所有事件都被处理
- 如果只使用 `transform`，此步骤影响较小，但仍建议调用以保证状态一致

### 3.3 Stalker.garbageCollect()

```javascript
Stalker.garbageCollect();
```

- **作用**：回收 Stalker 不再需要的 **已编译代码块内存**
- 必须在 `unfollow()` 之后、确认线程不再使用重编译代码时调用
- 通常在 `unfollow()` 后稍作延迟（或在 `setTimeout` 中）调用，确保线程已退出重编译代码

### 标准停止流程

```javascript
// 第一步：停止追踪
Stalker.unfollow(tid);

// 第二步：刷新未处理事件
Stalker.flush();

// 第三步：延迟回收内存（等待线程退出重编译代码）
setTimeout(() => {
  Stalker.garbageCollect();
}, 1000);
```

### 配合 Interceptor 的完整生命周期示例

```javascript
let tid = null;

Interceptor.attach(Module.getExportByName(null, 'targetFunc'), {
  onEnter() {
    tid = Process.getCurrentThreadId();
    Stalker.follow(tid, {
      transform(iterator) {
        let ins;
        while ((ins = iterator.next()) !== null) {
          if (ins.mnemonic === 'call') {
            iterator.putCallout((ctx) => {
              console.log('[call]', ctx.pc);
            });
          }
          iterator.keep();
        }
      }
    });
  },
  onLeave() {
    if (tid !== null) {
      Stalker.unfollow(tid);
      Stalker.flush();
      setTimeout(() => {
        Stalker.garbageCollect();
      }, 500);
      tid = null;
    }
  }
});
```

---

## 四、核心概念速查

| 概念 | 说明 |
|------|------|
| 基本块（Basic Block） | 以跳转/分支结束的连续指令序列，Stalker 的最小编译单元 |
| 重编译（Recompilation） | Stalker 将原始指令复制并注入回调后生成新的可执行代码 |
| `transform` | 每个基本块编译时的插桩钩子，在此修改指令流 |
| `iterator` | 遍历当前基本块指令的游标，控制指令的保留与插入 |
| `putCallout` | 在指令流中插入 JS 回调，运行时触发 |

---

## 五、常见注意事项

1. **`iterator.next()` 返回 `null` 即停止循环**，不能继续调用 `keep()` 或 `putCallout()`。
2. **每条指令默认不保留**，必须显式调用 `keep()` 才会出现在重编译代码中。
3. **`transform` 在 Frida 的 JS 线程中运行**，而目标线程在重编译代码中执行，两者异步。
4. **`unfollow` 后不要立即 `garbageCollect`**，线程可能还在执行重编译代码，需要延迟。
5. **追踪高频线程性能开销较大**，建议只在需要时追踪，用完立即停止。
6. **`putCallout` 中避免耗时操作**，会直接阻塞目标线程。
