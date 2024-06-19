import { getCreatedCourses } from "@/actions/courses";
import getCurrentUser from "@/actions/getCurrentUser";
import AttendanceClient from "@/components/Attendancefilters";

async function Filters() {
  const courses = await getCreatedCourses();
  const currentUser = await getCurrentUser()
  if(!currentUser) return null
  return <AttendanceClient courses={courses} role={currentUser.role} />;
}

export default Filters;
