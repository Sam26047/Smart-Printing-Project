import { createClient } from "redis";

const redisClient = createClient({
    url:"redis://redis:6379" //docker service name
});

redisClient.on("error", (err)=>
    console.error("Redis Client")
)

await redisClient.connect();

export default redisClient; //the object the program will use to execute cmds,like db client or pool