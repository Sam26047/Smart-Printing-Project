import { createClient } from "redis";

const redisUrl =
  process.env.REDIS_URL; //docker service name

const redisClient = createClient({ url: redisUrl });

redisClient.on("error", (err) =>
  console.error("Redis Client Error", err)
);

await redisClient.connect();

export default redisClient;  //the object the program will use to execute cmds,like db client or pool