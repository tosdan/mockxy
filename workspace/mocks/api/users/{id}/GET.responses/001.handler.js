// Example handler: a dynamic response driven by the path parameter, with the dataset kept
// out of the code in the "users" file of the Data page (workspace/files/users.json).
module.exports = {
  async resolveResponse({ params, data }) {
    const users = await data("users");
    const user = users.find((u) => u.id === Number(params.id));

    if (!user) {
      return { status: 404, jsonBody: { error: "user not found", id: params.id } };
    }
    return { status: 200, jsonBody: user };
  },
};
