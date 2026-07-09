既然你已经成功创建了名为 `nathanpenny` 的 D1 数据库，你已经完成了最核心的一步！

接下来，我们要通过 **3个主要步骤** 把整个流程跑通：在 D1 里建表 $\rightarrow$ 创建一个 Workers 编写后端代码 $\rightarrow$ 在你的前端 HTML/JS 里发起请求。

以下是保姆级的详细操作指南：

***

### 第一步：在 D1 数据库中创建数据表

我们需要在 `nathanpenny` 数据库里建一张表来存数据。这里我们以最常见的“**用户留言板（Messages）**”为例。

1. 登录 Cloudflare 控制台，进入 **Storage & Databases** -> **D1**。
2. 点击进入你的数据库 `nathanpenny`。
3. 切换到 **Console**（控制台）标签页。
4. 在输入框中粘贴以下 **SQL 语句**，然后点击 **Execute**（执行）：

```sql
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

```

*这条命令创建了一个叫* *`messages`* *的表，包含自增ID、名字、内容和自动记录的时间。*

***

### 第二步：创建并配置 Cloudflare Workers（后端）

纯前端的 JS 无法直接连接数据库，我们需要一个 Workers 扮演“中间人”。

#### 1. 创建 Worker

1. 在 Cloudflare 左侧菜单点击 **Compute (Workers & Pages)** -> **Overview**。
2. 点击 **Create** 按钮，选择 **Create Worker**。
3. 给你的 Worker 起个名字（例如：`nathanpenny-api`），点击 **Deploy**。
4. 部署成功后，点击 **Edit Code** 进入在线代码编辑器。

#### 2. 绑定 D1 数据库（非常关键 ⚠️）

在写代码前，必须让这个 Worker 知道它可以访问你的 D1 数据库：

1. 留在当前 Worker 页面，先点击左上角的箭头返回（或者在 Worker 详情页找到 **Settings** 标签页）。
2. 点击 **Bindings**（绑定）。
3. 点击 **Add** 按钮，选择 **D1 database**。
4. **Variable name（变量名）**：输入大写的 `DB`（代码里会用到）。
5. **D1 database**：在下拉菜单里选择你刚刚建好的 `nathanpenny`。
6. 点击 **Save** 保存。

#### 3. 编写 Worker 代码

重新进入 Worker 的 **Edit Code** 页面，将 `worker.js`（或 `index.js`）里的原有代码全部清空，替换为以下代码：

```javascript
export default {
  async fetch(request, env) {
    // 1. 设置跨域请求头 (CORS)，允许你前端网站安全访问
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", // 学习阶段设为 *，上线后可改成你的个人网站域名
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    // 2. 处理浏览器的预检请求 (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 3. 处理 POST 请求：前端提交数据
      if (request.method === "POST") {
        const { name, content } = await request.json();
        
        if (!name || !content) {
          return new Response(JSON.stringify({ error: "名字和内容不能为空" }), { status: 400, headers: corsHeaders });
        }

        // 执行 SQL 插入数据。这里的 env.DB 就是你刚刚绑定的 D1 数据库
        await env.DB.prepare("INSERT INTO messages (name, content) VALUES (?, ?)")
                    .bind(name, content)
                    .run();

        return new Response(JSON.stringify({ success: true, message: "保存成功！" }), { headers: corsHeaders });
      }

      // 4. 处理 GET 请求：前端获取数据
      if (request.method === "GET") {
        // 执行 SQL 查询，按时间倒序排列
        const { results } = await env.DB.prepare("SELECT * FROM messages ORDER BY created_at DESC").all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }

      // 如果是其他请求方法
      return new Response(JSON.stringify({ error: "不支持的方法" }), { status: 405, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};

```

1. 点击右上角的 **Deploy**（部署）保存并生效。
2. 部署后，复制这个 Worker 的 **访问网址（URL）**，它长得像：`https://nathanpenny-api.xxxx.workers.dev`。

***

### 第三步：修改你的前端网站（HTML + JavaScript）

现在后端和数据库都准备好了，我们回到你熟悉的纯前端。

#### 1. HTML 部分（增加一个表单和展示区域）

在你的 `index.html` 里适当位置加入表单和显示留言的 `div`：

```html
<form id="messageForm">
  <input type="text" id="username" placeholder="你的名字" required><br><br>
  <textarea id="textContent" placeholder="想说点什么..." required></textarea><br><br>
  <button type="submit">提交留言</button>
</form>

<hr>

<h3>所有留言：</h3>
<div id="messageList">加载中...</div>

```

#### 2. JavaScript 部分（发起网络请求）

在你的 `script.js` 里粘贴以下原生 JavaScript 代码：

```javascript
// ⚠️ 替换成你刚刚部署的 Worker 真实网址
const API_URL = "https://nathanpenny-api.xxxx.workers.dev"; 

const messageForm = document.getElementById('messageForm');
const messageList = document.getElementById('messageList');

// 页面加载时自动获取一次数据
window.addEventListener('DOMContentLoaded', fetchMessages);

// 功能 1：从数据库读取数据并渲染到页面上
async function fetchMessages() {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error('网络请求失败');
    
    const data = await response.json(); // 拿到数据库返回的数组
    
    // 清空旧内容
    messageList.innerHTML = '';
    
    if (data.length === 0) {
      messageList.innerHTML = '<p>暂无留言~</p>';
      return;
    }

    // 用原生 JS 循环数据并生成 HTML 结构
    data.forEach(item => {
      const msgDiv = document.createElement('div');
      msgDiv.style.borderBottom = "1px dashed #ccc";
      msgDiv.style.margin = "10px 0";
      msgDiv.innerHTML = `
        <strong>${item.name}</strong> (${new Date(item.created_at).toLocaleString()}): 
        <p>${item.content}</p>
      `;
      messageList.appendChild(msgDiv);
    });

  } catch (error) {
    messageList.innerHTML = `<p style="color:red">加载失败: ${error.message}</p>`;
  }
}

// 功能 2：提交表单数据到数据库
messageForm.addEventListener('submit', async (e) => {
  e.preventDefault(); // 阻止表单默认的页面刷新行为

  const name = document.getElementById('username').value;
  const content = document.getElementById('textContent').value;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: name, content: content })
    });

    const result = await response.json();

    if (result.success) {
      alert('留言成功！');
      messageForm.reset(); // 清空输入框
      fetchMessages();     // 重新加载列表，看到最新的留言
    } else {
      alert('失败：' + result.error);
    }
  } catch (error) {
    alert('提交出错：' + error.message);
  }
});

```

***

### 🎉 大功告成！

现在，在本地双击打开你的 `index.html`（或者用 Live Server 运行），在输入框里输入名字和内容点击提交。数据就会通过 Cloudflare Worker 飞进你的 `nathanpenny` D1 数据库。刷新页面，数据依然会稳稳地从云端加载出来！

按照这个流程试一下，如果在某一步遇到了报错，随时把报错信息发给我，我帮你看看哪里配置有误。
