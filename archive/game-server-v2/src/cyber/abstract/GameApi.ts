const BASE_URL = "https://oo-git-dev-oncyber.vercel.app";
// const BASE_URL = "http://localhost:3000";
const GAME_API_URL = `${BASE_URL}/api/games`;

const GAME_SERVER_KEY = process.env.GAME_SERVER_KEY;

delete process.env.GAME_SERVER_KEY;

export class GameApi {
  //
  static async loadGameData(opts: { id: string; draft?: boolean }) {
    // fetch the space here...
    const reponse = await fetch(
      `${GAME_API_URL}/${opts.id}?draft=${opts.draft}`,
      {
        headers: {
          "x-server-key": GAME_SERVER_KEY,
        },
      }
    );

    if (!reponse.ok) {
      throw new Error("failed to load game data");
    }

    const result = await reponse.json();

    return result;
  }

  static async auth(token: string) {
    const response = await fetch(`${GAME_API_URL}/auth/${token}`);

    if (!response.ok) {
      return null;
    }

    const result = await response.json();

    return result.data?.userId;
  }
}
