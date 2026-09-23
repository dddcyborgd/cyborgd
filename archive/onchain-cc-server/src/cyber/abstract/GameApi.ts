const GAME_API_URL = "https://oo-git-dev-oncyber.vercel.app/api/games";

export class GameApi {
  //
  static async loadGameData(opts: { id: string; draft?: boolean }) {
    // fetch the space here...
    const reponse = await fetch(
      `${GAME_API_URL}/${opts.id}?draft=${opts.draft}`
    );

    if (!reponse.ok) {
      throw new Error("failed to load game data");
    }

    const result = await reponse.json();

    return result.data;
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
