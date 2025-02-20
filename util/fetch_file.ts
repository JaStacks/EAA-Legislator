
import axios from "axios";

export async function fetchFile(url: string): Promise<any> {
  try {
    const response = await axios.get(url);
    console.log(`File loaded successfully from ${url}`);
    return response.data; // Return the parsed JSON content
  } catch (error) {
    console.error(`Error fetching file from ${url}:`, error);
    throw new Error(`Failed to fetch file from ${url}`);
  }
}
