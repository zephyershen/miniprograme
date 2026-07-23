# 专栏集合权限核对

以下集合只允许云函数访问，客户端页面不得直接读写：

- `knowledge_column_cases`
- `knowledge_trend_dossiers`
- `knowledge_trend_events`

集合首次由 `knowledgeFeed` 创建后，在 CloudBase 控制台逐一确认安全规则为：

```json
{
  "read": false,
  "write": false
}
```

CloudBase 数据库安全规则只限制客户端请求，不影响云函数以服务端身份访问。官方规则说明见：<https://cloud.tencent.com/document/product/876/41802>。

客户端必须只调用 `columnHome`、`columnLesson`、`columnCases`、`columnCase` 和 `trendDossier`；其中除首页目录外，其余正文接口都会在服务端重新验证 Pro/管理员权益。
