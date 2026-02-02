export interface UserPrompt {
  ask(prompt: string): Promise<string>;
}

export class NodeUserPrompt implements UserPrompt {
  async ask(prompt: string): Promise<string> {
    const readline = await import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise<string>((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}
