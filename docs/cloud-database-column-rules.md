# 专栏集合权限核对

以下集合只允许云函数访问，客户端页面不得直接读写：

- `knowledge_column_cases`
- `knowledge_column_entries`
- `knowledge_column_media`
- `knowledge_column_progress`
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

会员客户端必须只调用 `columnHome`、`columnLesson`、`columnPractical`、`columnProgressList`、`columnProgressSave`、`columnCases`、`columnCase` 和 `trendDossier`；其中除首页目录外，其余正文和进度接口都会在服务端重新验证 Pro/管理员权益。阅读进度只按当前微信身份派生的 `ownerKey` 读写，客户端不能指定其他用户。内容管理接口只接受 `isActualAdmin` 为真的微信身份，管理员身份预览不能撤销这项真实权限，普通会员也不能通过伪造 action 取得草稿或上传图片。
